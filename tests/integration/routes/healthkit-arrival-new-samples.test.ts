/**
 * Apple Health freshness counts only new samples as an arrival (#1259),
 * through the real API kit against the real database.
 *
 * Since the phone walks its history and re-sends old samples, most batches
 * carry duplicates. Each one used to move the type's `lastReceivedAt`,
 * `lastTrigger` and `lastBackgroundAt`, so a type whose live delivery had
 * stalled read "arrived in the background a minute ago" for as long as a
 * replay, a retry or an older client kept sending it. Now:
 *   - a batch that brings a new or changed row of a type is its arrival, as
 *     before;
 *   - a batch that carries the type with duplicates only moves none of the
 *     arrival stamps and stamps `lastSeenDuplicateAt` instead, which the
 *     status read serves;
 *   - an unchanged `stats:` re-post and an hour posted again with its stored
 *     value count as duplicates here, while the wire keeps answering
 *     `updated` for them;
 *   - the account-level sync stamps are untouched by this rule;
 *   - the dose ledger of the intake bulk route follows the same rule.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { GET as getHealthKit } from "@/app/api/integrations/healthkit/route";
import { POST as postMeasurements } from "@/app/api/measurements/batch/route";
import { POST as postDoses } from "@/app/api/medications/intake/bulk/route";

import { callRoute } from "../../kit/call-route";
import {
  makeMedication,
  makeSession,
  makeUser,
  type SessionFixture,
} from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();
const STEPS = "HKQuantityTypeIdentifierStepCount";

let auth: SessionFixture;
let userId: string;

beforeEach(async () => {
  await truncateAllTables(prisma);
  const user = await makeUser({ timezone: "UTC" });
  userId = user.id;
  auth = await makeSession(user);
});

function pulse(at: string, externalId: string, value = 61) {
  return {
    hkIdentifier: "HKQuantityTypeIdentifierHeartRate",
    value,
    unit: "count/min",
    startDate: at,
    endDate: at,
    externalId,
  };
}

function stepsDay(day: string, value: number) {
  return {
    hkIdentifier: STEPS,
    value,
    unit: "count",
    startDate: `${day}T00:00:00.000Z`,
    endDate: `${day}T23:59:59.000Z`,
    externalId: `stats:${STEPS}:${day}`,
  };
}

function stepsHour(day: string, hour: number, value: number) {
  const hh = String(hour).padStart(2, "0");
  const start = `${day}T${hh}:00:00.000Z`;
  return {
    hkIdentifier: STEPS,
    value,
    unit: "count",
    startDate: start,
    endDate: new Date(Date.parse(start) + 3_600_000).toISOString(),
    externalId: `stats:${STEPS}:${day}T${hh}`,
  };
}

async function post(entries: unknown[], syncTrigger: string) {
  const res = await callRoute<{ entries: Array<{ status: string }> }>(
    postMeasurements,
    {
      method: "POST",
      route: "/api/measurements/batch",
      auth,
      body: { syncTrigger, entries },
    },
  );
  expect(res.status).toBe(200);
  return res.data.entries.map((entry) => entry.status);
}

async function ledger(type: string) {
  return prisma.healthKitTypeSync.findUniqueOrThrow({
    where: { userId_type: { userId, type } },
  });
}

/** Let the clock move, so a stamp that moved is distinguishable. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const T1 = "2026-10-20T14:55:00.000Z";
const T2 = "2026-10-21T08:30:00.000Z";

describe("a duplicates-only batch is not an arrival", () => {
  it("keeps the arrival, trigger and background stamps and dates the re-send", async () => {
    await post([pulse(T1, "uuid-p1")], "foreground");
    const first = await ledger("PULSE");
    expect(first.lastSeenDuplicateAt).toBeNull();

    await tick();
    expect(await post([pulse(T1, "uuid-p1")], "background")).toEqual([
      "duplicate",
    ]);
    const second = await ledger("PULSE");

    expect(second.lastReceivedAt).toEqual(first.lastReceivedAt);
    expect(second.lastTrigger).toBe("foreground");
    expect(second.lastNewSampleAt).toEqual(first.lastNewSampleAt);
    expect(second.lastBackgroundAt).toBeNull();
    expect(second.lastSeenDuplicateAt?.getTime()).toBeGreaterThan(
      first.lastReceivedAt.getTime(),
    );

    // The account-level stamps still say the phone delivers (#1259 leaves
    // them as they are: `lastSyncedAt` sizes the client's window).
    const account = await prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { lastSyncedAt: true, healthKitLastSyncTrigger: true },
    });
    expect(account.lastSyncedAt?.getTime()).toBeGreaterThan(
      first.lastReceivedAt.getTime(),
    );
    expect(account.healthKitLastSyncTrigger).toBe("background");

    const status = await callRoute<{
      metricFreshness: Array<{
        type: string;
        lastReceivedAt?: string | null;
        lastTrigger?: string | null;
        lastSeenDuplicateAt?: string | null;
      }>;
    }>(getHealthKit, {
      method: "GET",
      route: "/api/integrations/healthkit",
      auth,
    });
    expect(status.status).toBe(200);
    const row = status.data.metricFreshness.find((e) => e.type === "PULSE");
    expect(row).toMatchObject({
      lastReceivedAt: first.lastReceivedAt.toISOString(),
      lastTrigger: "foreground",
      lastSeenDuplicateAt: second.lastSeenDuplicateAt?.toISOString(),
    });
  });

  it("counts a batch with one new row among duplicates as an arrival", async () => {
    await post([pulse(T1, "uuid-p1")], "foreground");
    const first = await ledger("PULSE");
    await tick();
    expect(
      await post(
        [pulse(T1, "uuid-p1"), pulse(T2, "uuid-p2", 64)],
        "background",
      ),
    ).toEqual(["duplicate", "inserted"]);
    const second = await ledger("PULSE");
    expect(second.lastReceivedAt.getTime()).toBeGreaterThan(
      first.lastReceivedAt.getTime(),
    );
    expect(second.lastTrigger).toBe("background");
    expect(second.lastBackgroundAt).toEqual(second.lastReceivedAt);
    expect(second.lastNewSampleAt).toEqual(second.lastReceivedAt);
  });

  it("creates no ledger row for a type that has only ever been re-sent", async () => {
    // A sample stored before the ledger existed, re-sent by the phone.
    await prisma.measurement.create({
      data: {
        userId,
        type: "PULSE",
        value: 61,
        unit: "bpm",
        source: "APPLE_HEALTH",
        externalId: "uuid-p1",
        measuredAt: new Date(T1),
      },
    });
    expect(await post([pulse(T1, "uuid-p1")], "background")).toEqual([
      "duplicate",
    ]);
    expect(await prisma.healthKitTypeSync.count({ where: { userId } })).toBe(0);
  });
});

describe("re-posts that change nothing", () => {
  it("treats an unchanged stats: day as a duplicate and a changed one as an arrival", async () => {
    await post([stepsDay("2026-10-20", 8421)], "foreground");
    const first = await ledger("ACTIVITY_STEPS");

    await tick();
    expect(await post([stepsDay("2026-10-20", 8421)], "background")).toEqual([
      "updated",
    ]);
    const unchanged = await ledger("ACTIVITY_STEPS");
    expect(unchanged.lastReceivedAt).toEqual(first.lastReceivedAt);
    expect(unchanged.lastTrigger).toBe("foreground");
    expect(unchanged.lastSeenDuplicateAt).not.toBeNull();

    await tick();
    expect(await post([stepsDay("2026-10-20", 9100)], "background")).toEqual([
      "updated",
    ]);
    const changed = await ledger("ACTIVITY_STEPS");
    expect(changed.lastReceivedAt.getTime()).toBeGreaterThan(
      first.lastReceivedAt.getTime(),
    );
    expect(changed.lastTrigger).toBe("background");
  });

  it("treats an hour posted again with its stored value as a duplicate", async () => {
    const day = "2026-10-21";
    expect(await post([stepsHour(day, 8, 400)], "foreground")).toEqual([
      "inserted",
    ]);
    const first = await ledger("ACTIVITY_STEPS");

    await tick();
    expect(await post([stepsHour(day, 8, 400)], "background")).toEqual([
      "updated",
    ]);
    const unchanged = await ledger("ACTIVITY_STEPS");
    expect(unchanged.lastReceivedAt).toEqual(first.lastReceivedAt);
    expect(unchanged.lastSeenDuplicateAt).not.toBeNull();

    await tick();
    expect(await post([stepsHour(day, 8, 520)], "background")).toEqual([
      "updated",
    ]);
    const changed = await ledger("ACTIVITY_STEPS");
    expect(changed.lastReceivedAt.getTime()).toBeGreaterThan(
      first.lastReceivedAt.getTime(),
    );
  });
});

describe("Apple Health doses follow the same rule", () => {
  it("does not move the dose arrival for a replay of a dose already stored", async () => {
    const medication = await makeMedication(
      { id: userId },
      { externalSource: "APPLE_HEALTH", externalId: "hk-med-arrival" },
    );
    const dose = {
      medicationId: medication.id,
      scheduledFor: T1,
      takenAt: T1,
      source: "APPLE_HEALTH",
      externalId: "hk-dose-1",
    };
    const send = (syncTrigger: string) =>
      callRoute<{ entries: Array<{ status: string }> }>(postDoses, {
        method: "POST",
        route: "/api/medications/intake/bulk",
        auth,
        body: { syncTrigger, entries: [dose] },
      });
    expect((await send("foreground")).status).toBe(200);
    const first = await ledger("MEDICATION_DOSE");

    await tick();
    const replay = await send("background");
    expect(replay.data.entries.map((e) => e.status)).toEqual(["duplicate"]);
    const second = await ledger("MEDICATION_DOSE");
    expect(second.lastReceivedAt).toEqual(first.lastReceivedAt);
    expect(second.lastTrigger).toBe("foreground");
    expect(second.lastBackgroundAt).toBeNull();
    expect(second.lastSeenDuplicateAt).not.toBeNull();
  });
});
