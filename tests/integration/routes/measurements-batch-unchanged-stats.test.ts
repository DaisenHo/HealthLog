/**
 * `POST /api/measurements/batch`: a `stats:` row re-posted with nothing
 * changed, through the real API kit against the real database.
 *
 * The phone re-sends the same daily totals on every sync. Such a re-post:
 *   - answers exactly what it answered before: per entry `updated`, and the
 *     same `updated` count in the summary;
 *   - writes nothing (the stored row keeps its `syncVersion` and
 *     `updatedAt`), and starts nothing: no rollup refold, no cache
 *     invalidation, no PR detection;
 *   - goes the old way as soon as one column differs (the value, the unit,
 *     the device, the source version, the sleep stage), and for a tombstoned
 *     row (a resurrection), so those are written and start the tail as
 *     before;
 *   - costs a handful of statements for a batch of them, instead of a
 *     reconciler transaction each.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/measurements/batch/route";

import { callRoute } from "../../kit/call-route";
import {
  makeSession,
  makeUser,
  type SessionFixture,
} from "../../kit/factories";
import { countStatements } from "../query-counter";
import { getPrismaClient, truncateAllTables } from "../setup";

const tail = vi.hoisted(() => ({ rollups: 0, invalidations: 0, prs: 0 }));
vi.mock("@/lib/rollups/after-measurement-mutation", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/rollups/after-measurement-mutation")
  >("@/lib/rollups/after-measurement-mutation");
  return {
    ...actual,
    afterMeasurementMutation: (
      ...args: Parameters<typeof actual.afterMeasurementMutation>
    ) => {
      tail.rollups += 1;
      return actual.afterMeasurementMutation(...args);
    },
  };
});
vi.mock("@/lib/cache/invalidate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cache/invalidate")>(
    "@/lib/cache/invalidate",
  );
  return {
    ...actual,
    invalidateUserMeasurements: (
      ...args: Parameters<typeof actual.invalidateUserMeasurements>
    ) => {
      tail.invalidations += 1;
      return actual.invalidateUserMeasurements(...args);
    },
  };
});
vi.mock("@/lib/jobs/pr-detection", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/jobs/pr-detection")
  >("@/lib/jobs/pr-detection");
  return {
    ...actual,
    enqueuePrDetection: async () => {
      tail.prs += 1;
    },
  };
});

const prisma = getPrismaClient();
const ROUTE = "/api/measurements/batch";
const DAYS = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

function stepsEntry(
  day: string,
  value: number,
  deviceType = "watch",
  externalSourceVersion?: string,
) {
  return {
    ...(externalSourceVersion ? { externalSourceVersion } : {}),
    hkIdentifier: "HKQuantityTypeIdentifierStepCount",
    value,
    unit: "count",
    startDate: `${day}T00:00:00.000Z`,
    endDate: `${day}T23:59:59.000Z`,
    externalId: `stats:HKQuantityTypeIdentifierStepCount:${day}`,
    deviceType,
  };
}

let auth: SessionFixture;
let userId: string;

async function post(entries: unknown[]) {
  return callRoute<{
    updated: number;
    inserted: number;
    entries: Array<{ status: string }>;
  }>(POST, { method: "POST", route: ROUTE, auth, body: { entries } });
}

function resetTail() {
  tail.rollups = 0;
  tail.invalidations = 0;
  tail.prs = 0;
}

beforeEach(async () => {
  await truncateAllTables(prisma);
  const user = await makeUser({ timezone: "UTC" });
  userId = user.id;
  auth = await makeSession(user);
  const first = await post(DAYS.map((d, i) => stepsEntry(d, 1000 + i)));
  expect(first.status).toBe(200);
  expect(first.data.inserted).toBe(DAYS.length);
  resetTail();
});

async function storedVersions() {
  const rows = await prisma.measurement.findMany({
    where: { userId, externalId: { startsWith: "stats:" } },
    orderBy: { externalId: "asc" },
    select: { syncVersion: true, updatedAt: true, value: true },
  });
  return rows;
}

describe("an unchanged stats: re-post", () => {
  it("answers `updated` as before, writes nothing and starts nothing", async () => {
    const before = await storedVersions();
    const measured = await countStatements(() =>
      post(DAYS.map((d, i) => stepsEntry(d, 1000 + i))),
    );
    const res = measured.result;
    expect(res.status).toBe(200);
    expect(res.data.updated).toBe(DAYS.length);
    expect(res.data.inserted).toBe(0);
    expect(res.data.entries.map((e) => e.status)).toEqual(
      DAYS.map(() => "updated"),
    );
    expect(await storedVersions()).toEqual(before);
    expect(tail).toEqual({ rollups: 0, invalidations: 0, prs: 0 });
    // Four reconciler transactions used to be about forty statements.
    expect(measured.count).toBeLessThanOrEqual(12);
  });

  it("writes and starts the tail when one column differs", async () => {
    const before = (await storedVersions()).map((r) => r.syncVersion);
    const res = await post([
      stepsEntry(DAYS[0]!, 1000), // unchanged
      stepsEntry(DAYS[1]!, 5555), // new value
      stepsEntry(DAYS[2]!, 1002, "phone"), // new device
    ]);
    expect(res.data.entries.map((e) => e.status)).toEqual([
      "updated",
      "updated",
      "updated",
    ]);
    expect(res.data.updated).toBe(3);
    const after = await storedVersions();
    expect(after.map((r) => r.syncVersion)).toEqual([
      before[0],
      before[1]! + 1,
      before[2]! + 1,
      before[3],
    ]);
    expect(after[1]!.value).toBe(5555);
    expect(tail.rollups).toBe(1);
    expect(tail.invalidations).toBeGreaterThanOrEqual(1);
    expect(tail.prs).toBe(1);
  });

  it("writes a re-post that changes only the source version, the device or the sleep stage", async () => {
    // The overwrite contract of a `stats:` row covers these columns as much as
    // the value: a re-post that only names a new HealthKit source version, a
    // new device or a new sleep stage replaces the stored one.
    const night = {
      hkIdentifier: "HKCategoryTypeIdentifierSleepAnalysis",
      value: 95,
      unit: "category",
      startDate: "2026-10-05T01:00:00.000Z",
      endDate: "2026-10-05T02:35:00.000Z",
      externalId: "stats:HKCategoryTypeIdentifierSleepAnalysis:2026-10-05",
      sleepStage: 3,
    };
    const seeded = await post([night]);
    expect(seeded.data.inserted).toBe(1);
    const sleepRow = () =>
      prisma.measurement.findFirstOrThrow({
        where: { userId, externalId: night.externalId },
        select: { syncVersion: true, sleepStage: true },
      });
    const sleepBefore = await sleepRow();
    const before = (await storedVersions()).map((r) => r.syncVersion);
    resetTail();

    const res = await post([
      stepsEntry(DAYS[0]!, 1000, "watch", "17.1"), // new source version
      stepsEntry(DAYS[1]!, 1001, "phone"), // new device
      { ...night, sleepStage: 4 }, // new sleep stage
    ]);
    expect(res.status).toBe(200);
    expect(res.data.entries.map((e) => e.status)).toEqual([
      "updated",
      "updated",
      "updated",
    ]);

    const after = await prisma.measurement.findMany({
      where: { userId, externalId: { startsWith: "stats:HKQuantity" } },
      orderBy: { externalId: "asc" },
      select: {
        syncVersion: true,
        externalSourceVersion: true,
        deviceType: true,
      },
    });
    expect(after.map((r) => r.syncVersion)).toEqual([
      before[0]! + 1,
      before[1]! + 1,
      before[2],
      before[3],
    ]);
    expect(after[0]!.externalSourceVersion).toBe("17.1");
    expect(after[1]!.deviceType).toBe("phone");
    const sleepAfter = await sleepRow();
    expect(sleepAfter.sleepStage).toBe("DEEP");
    expect(sleepAfter.syncVersion).toBe(sleepBefore.syncVersion + 1);
    expect(tail.rollups).toBe(1);
  });

  it("resurrects a tombstoned row the old way", async () => {
    await prisma.measurement.updateMany({
      where: {
        userId,
        externalId: `stats:HKQuantityTypeIdentifierStepCount:${DAYS[3]}`,
      },
      data: { deletedAt: new Date() },
    });
    const res = await post([stepsEntry(DAYS[3]!, 1003)]);
    expect(res.data.entries[0]!.status).toBe("updated");
    const row = await prisma.measurement.findFirst({
      where: {
        userId,
        externalId: `stats:HKQuantityTypeIdentifierStepCount:${DAYS[3]}`,
      },
      select: { deletedAt: true },
    });
    expect(row?.deletedAt).toBeNull();
    expect(tail.rollups).toBe(1);
  });
});
