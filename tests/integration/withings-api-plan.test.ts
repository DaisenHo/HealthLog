/**
 * Withings API plans (2026-10-12) against the real schema: the plan memory is
 * merged per leg by one SQL statement, a measure sync refused with 277 still
 * imports what the plan allows, and a connection an earlier build parked over
 * a 277 is lifted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { encrypt } from "@/lib/crypto";

import { getPrismaClient, truncateAllTables } from "./setup";

const USER = "user-withings-api-plan";
const LAST_GOOD_SYNC = new Date(Date.now() - 2 * 86_400_000);
const ADVANCED = new Set([91, 155, 170, 123, 73]);

beforeEach(async () => {
  const prisma = getPrismaClient();
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: {
      id: USER,
      username: "withings-api-plan",
      email: "withings-api-plan@example.test",
    },
  });
  await prisma.withingsConnection.create({
    data: {
      userId: USER,
      withingsUserId: "wu-plan",
      accessToken: encrypt("access-token"),
      refreshToken: encrypt("refresh-token"),
      tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      scope: "user.metrics,user.activity",
      lastSyncedAt: LAST_GOOD_SYNC,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A plan that refuses the documented advanced meastypes with 277. */
function stubFreePlan() {
  const calls: number[][] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const types = (new URLSearchParams(init.body).get("meastypes") ?? "")
        .split(",")
        .map(Number);
      calls.push(types);
      if (types.some((t) => ADVANCED.has(t))) {
        return { status: 200, json: async () => ({ status: 277 }) };
      }
      return {
        status: 200,
        json: async () => ({
          status: 0,
          body: {
            measuregrps: [
              {
                grpid: 1,
                date: Math.floor((Date.now() - 86_400_000) / 1000),
                measures: [
                  { type: 1, value: 8120, unit: -2 },
                  { type: 10, value: 128, unit: 0 },
                  { type: 9, value: 82, unit: 0 },
                ],
              },
            ],
            more: 0,
          },
        }),
      };
    }),
  );
  return calls;
}

describe("Withings plan memory", () => {
  it("merges each leg without dropping the other", async () => {
    const { persistWithingsPlanLeg, parseWithingsApiPlanState } =
      await import("@/lib/withings/api-plan");
    await persistWithingsPlanLeg(USER, "measures", {
      unavailable: [155, 91],
      checkedAt: "2026-10-14T10:00:00.000Z",
    });
    await persistWithingsPlanLeg(USER, "ecg", {
      unavailable: ["heart"],
      checkedAt: "2026-10-14T10:41:00.000Z",
    });

    const row = await getPrismaClient().withingsConnection.findUnique({
      where: { userId: USER },
      select: { apiPlanState: true },
    });
    expect(parseWithingsApiPlanState(row?.apiPlanState)).toEqual({
      version: 1,
      measures: {
        unavailable: [155, 91],
        checkedAt: "2026-10-14T10:00:00.000Z",
      },
      ecg: { unavailable: ["heart"], checkedAt: "2026-10-14T10:41:00.000Z" },
    });
  });

  it("replaces a stored value that is not a v1 object", async () => {
    const prisma = getPrismaClient();
    await prisma.withingsConnection.update({
      where: { userId: USER },
      data: { apiPlanState: { version: 2, measures: "junk" } },
    });
    const { persistWithingsPlanLeg } = await import("@/lib/withings/api-plan");
    await persistWithingsPlanLeg(USER, "sleepSummary", {
      unavailable: ["sleep_score"],
      checkedAt: "2026-10-14T10:15:00.000Z",
    });

    const row = await prisma.withingsConnection.findUnique({
      where: { userId: USER },
      select: { apiPlanState: true },
    });
    expect(row?.apiPlanState).toEqual({
      version: 1,
      sleepSummary: {
        unavailable: ["sleep_score"],
        checkedAt: "2026-10-14T10:15:00.000Z",
      },
    });
  });
});

describe("syncUserMeasurements on the free plan", () => {
  it("imports the core types, remembers the refusal and skips it next time", async () => {
    const calls = stubFreePlan();
    const { syncUserMeasurements } = await import("@/lib/withings/sync");

    const first = await syncUserMeasurements(USER);
    expect(first.failed).toBe(false);
    expect(first.imported).toBe(3);
    expect(calls).toHaveLength(2);

    const prisma = getPrismaClient();
    const conn = await prisma.withingsConnection.findUnique({
      where: { userId: USER },
      select: { apiPlanState: true, lastSyncedAt: true },
    });
    expect(conn?.lastSyncedAt?.getTime()).toBeGreaterThan(
      LAST_GOOD_SYNC.getTime(),
    );
    expect(
      (conn?.apiPlanState as { measures: { unavailable: number[] } }).measures
        .unavailable,
    ).toEqual([73, 91, 123, 155, 170]);

    const rows = await prisma.measurement.findMany({
      where: { userId: USER, source: "WITHINGS" },
      select: { type: true },
    });
    expect(rows.map((r) => r.type).sort()).toEqual([
      "BLOOD_PRESSURE_DIA",
      "BLOOD_PRESSURE_SYS",
      "WEIGHT",
    ]);
    const status = await prisma.integrationStatus.findUnique({
      where: { userId_integration: { userId: USER, integration: "withings" } },
      select: { state: true },
    });
    expect(status?.state).toBe("connected");

    calls.length = 0;
    await syncUserMeasurements(USER);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.some((t) => ADVANCED.has(t))).toBe(false);
  });
});

describe("releasePlanGatedWithingsParks", () => {
  it("lifts a park recorded over a 277 and leaves a revoked grant parked", async () => {
    const prisma = getPrismaClient();
    await prisma.user.create({
      data: {
        id: "user-revoked",
        username: "revoked",
        email: "revoked@example.test",
      },
    });
    await prisma.integrationStatus.createMany({
      data: [
        {
          userId: USER,
          integration: "withings",
          state: "error_reauth",
          lastError: encrypt(
            "Withings measure error: 277 - One of the data type requested in this API request is not available in your API plan",
          ),
          consecutiveFailuresByKind: {
            transient: 0,
            reauth_required: 30,
            persistent: 0,
          },
          failingLegs: ["measures", "ecg"],
        },
        {
          userId: "user-revoked",
          integration: "withings",
          state: "error_reauth",
          lastError: encrypt("Withings refresh error: 101 - invalid token"),
        },
      ],
    });

    const { releasePlanGatedWithingsParks } =
      await import("@/lib/withings/api-plan");
    expect(await releasePlanGatedWithingsParks()).toBe(1);

    const rows = await prisma.integrationStatus.findMany({
      orderBy: { userId: "asc" },
      select: { userId: true, state: true, failingLegs: true },
    });
    expect(rows).toEqual([
      { userId: "user-revoked", state: "error_reauth", failingLegs: null },
      { userId: USER, state: "connected", failingLegs: [] },
    ]);
  });
});
