/**
 * The Oura backfill's slice logic with the provider and the database stubbed:
 * where a slice stops, what it saves, where the next one starts, and how long
 * it waits. The real walk against Postgres is
 * `tests/integration/oura-backfill.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  stored: null as unknown,
  completedAt: null as Date | null,
  sends: [] as Array<{ payload: unknown; startAfter?: number }>,
  windows: [] as string[],
  /** Per collection: what a window read does. */
  behave: {} as Record<
    string,
    (w: { startDate: string; endDate: string }) => Promise<unknown[]>
  >,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({
        ouraBackfillProgress: h.stored,
        ouraBackfillCompletedAt: h.completedAt,
      })),
      update: vi.fn(
        async ({
          data,
        }: {
          data: {
            ouraBackfillProgress?: unknown;
            ouraBackfillCompletedAt?: Date;
          };
        }) => {
          if (data.ouraBackfillProgress !== undefined) {
            h.stored = JSON.parse(JSON.stringify(data.ouraBackfillProgress));
          }
          if (data.ouraBackfillCompletedAt) {
            h.completedAt = data.ouraBackfillCompletedAt;
          }
        },
      ),
    },
  },
}));
vi.mock("@/lib/oura/retire-distance", () => ({
  OURA_EQUIVALENT_DISTANCE_WHERE: {},
  retireOuraEquivalentDistance: vi.fn(async () => 0),
}));
vi.mock("@/lib/oura/credentials", () => ({
  getOuraConnection: vi.fn(async () => ({
    accessToken: "acc",
    refreshTokenCiphertext: "enc",
    scopeDenied: [],
  })),
}));
vi.mock("@/lib/oura/oauth-descriptor", () => ({
  refreshOuraAfterRefusal: vi.fn(async () => "fresh"),
}));
vi.mock("@/lib/integrations/status", () => ({
  isReauthRequired: vi.fn(async () => false),
}));
vi.mock("@/lib/tz/resolver", () => ({
  resolveUserTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/sleep/sweep-stale-segments", () => ({
  sweepStaleSleepSegments: vi.fn(async () => {}),
}));
vi.mock("@/lib/oura/sync-heart-rate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/oura/sync-heart-rate")>()),
  refoldOuraTouchedDays: vi.fn(async () => {}),
}));
vi.mock("@/lib/jobs/boss-instance", () => ({
  getGlobalBoss: () => ({
    send: async (
      _queue: string,
      payload: unknown,
      options: { startAfter?: number },
    ) => {
      h.sends.push({ payload, startAfter: options.startAfter });
      return "job";
    },
  }),
}));
vi.mock("@/lib/oura/sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oura/sync")>();
  return {
    ...actual,
    ouraCollectionReader:
      (name: string, ctx: { query: { startDate: string; endDate: string } }) =>
      async () => {
        h.windows.push(`${name}:${ctx.query.startDate}..${ctx.query.endDate}`);
        return (h.behave[name] ?? (async () => []))(ctx.query);
      },
    upsertOuraMeasurements: vi.fn(
      async (_u: string, readings: unknown[]) => readings.length,
    ),
    retireOuraSleepRecords: vi.fn(async () => 0),
    recordOuraSyncFailure: vi.fn(async () => {}),
  };
});

import { OuraApiError } from "@/lib/oura/response-classifier";
import { OURA_BACKFILL_ORDER, runOuraBackfillForUser } from "../oura-backfill";

const T0 = Date.parse("2026-10-01T12:00:00Z");

/** Activity on every window from mid-2026: history starts 2026-06-01. */
function activityFrom(first: string) {
  return async (w: { startDate: string; endDate: string }) =>
    w.endDate < first
      ? []
      : [
          {
            type: "ACTIVITY_STEPS",
            value: 1,
            unit: "steps",
            measuredAt: new Date(
              `${w.startDate < first ? first : w.startDate}T12:00:00Z`,
            ),
            externalId: `activity:${w.startDate}:steps`,
          },
        ];
}

/** A clock that moves one second per read. */
function clock() {
  let t = T0;
  return () => (t += 1000);
}

beforeEach(() => {
  h.stored = null;
  h.completedAt = null;
  h.sends = [];
  h.windows = [];
  h.behave = { activity: activityFrom("2026-06-01") };
});

describe("runOuraBackfillForUser", () => {
  it("stops on its budget, saves where each collection got to, and resumes there", async () => {
    const first = await runOuraBackfillForUser("u1", () => false, 0, {
      sliceMs: 10_000,
      now: clock(),
    });
    expect(first.continued).toBe(true);
    expect(h.sends[0]!.payload).toMatchObject({
      kind: "oura-backfill",
      data: { userId: "u1", slice: 1 },
    });
    const saved = h.stored as {
      anchor: string;
      collections: Record<string, { before: string }>;
    };
    expect(saved.anchor).toBe("2026-10-01");
    const lastWindow = h.windows.at(-1)!;
    const [name, range] = lastWindow.split(":");
    expect(saved.collections[name!]!.before).toBe(range!.split("..")[0]);

    // The next slice opens with the window right before the saved edge.
    h.windows = [];
    await runOuraBackfillForUser("u1", () => false, 1, {
      sliceMs: 10_000,
      now: clock(),
    });
    expect(h.windows[0]!.startsWith(`${name}:`)).toBe(true);
    expect(
      h.windows[0]!.endsWith(`..${saved.collections[name!]!.before}`),
    ).toBe(true);
  });

  it("runs to the end and learns where history starts", async () => {
    let slice = 0;
    let continued = true;
    while (continued) {
      continued = (
        await runOuraBackfillForUser("u1", () => false, slice++, {
          sliceMs: 60_000,
          now: clock(),
        })
      ).continued;
      expect(slice).toBeLessThan(100);
    }
    expect(h.completedAt).not.toBeNull();
    const saved = h.stored as {
      historyStart: string;
      collections: Record<string, { done?: boolean; before: string }>;
    };
    expect(saved.historyStart).toBe("2026-06-01");
    for (const name of OURA_BACKFILL_ORDER) {
      expect(saved.collections[name]!.done).toBe(true);
    }
    // The non-probe collections stop a week before the history start.
    expect(saved.collections.heartrate!.before).toBe("2026-05-25");
    expect(
      h.windows
        .filter((w) => w.startsWith("heartrate:"))
        .every((w) => {
          const start = w.split(":")[1]!.split("..")[0]!;
          return start >= "2026-05-25";
        }),
    ).toBe(true);
    // No window read twice.
    expect(new Set(h.windows).size).toBe(h.windows.length);
  });

  it("waits out the Retry-After a 429 named before the next slice", async () => {
    h.behave.activity = async () => {
      throw new OuraApiError({
        verb: "fetchDailyActivity",
        classification: "transient",
        httpStatus: 429,
        reason: "http_429",
        retryAfterMs: 900_000,
      });
    };
    const run = await runOuraBackfillForUser("u1", () => false, 3, {
      now: clock(),
    });
    expect(run.continued).toBe(true);
    expect(h.sends).toHaveLength(1);
    expect(h.sends[0]!.startAfter).toBe(900);
    expect(h.sends[0]!.payload).toMatchObject({ data: { slice: 4 } });
  });

  it("marks a collection the grant refuses as denied, finishes, and asks again on the next chain", async () => {
    h.behave.workout = async () => {
      throw new OuraApiError({
        verb: "fetchWorkouts",
        classification: "reauth_required",
        httpStatus: 401,
        reason: "scope_missing",
        missingScope: "workout",
      });
    };
    let slice = 0;
    let continued = true;
    while (continued) {
      continued = (
        await runOuraBackfillForUser("u1", () => false, slice++, {
          sliceMs: 60_000,
          now: clock(),
        })
      ).continued;
    }
    expect(h.completedAt).not.toBeNull();
    const saved = h.stored as {
      collections: Record<string, { denied?: boolean }>;
    };
    expect(saved.collections.workout!.denied).toBe(true);
    expect(h.windows.filter((w) => w.startsWith("workout:"))).toHaveLength(1);

    // A connect reopens it; the first slice asks for workouts again and
    // nothing else.
    h.completedAt = null;
    h.windows = [];
    delete h.behave.workout;
    await runOuraBackfillForUser("u1", () => false, 0, {
      sliceMs: 60_000,
      now: clock(),
    });
    expect(new Set(h.windows.map((w) => w.split(":")[0]))).toEqual(
      new Set(["workout"]),
    );
    expect(h.completedAt).not.toBeNull();
  });

  it("goes on with the other collections past a failing one, and throws when nothing moved", async () => {
    h.behave.spo2 = async () => {
      throw new OuraApiError({
        verb: "fetchDailySpo2",
        classification: "transient",
        httpStatus: 502,
        reason: "http_502",
      });
    };
    const run = await runOuraBackfillForUser("u1", () => false, 0, {
      sliceMs: 600_000,
      now: clock(),
    });
    // Everything but spo2 moved, so the chain goes on.
    expect(run.continued).toBe(true);
    const saved = h.stored as {
      collections: Record<string, { done?: boolean }>;
    };
    expect(saved.collections.heartrate!.done).toBe(true);
    expect(saved.collections.spo2!.done).toBeUndefined();

    // Now only spo2 is left, and it fails again: no progress, so it throws
    // for the pg-boss retry instead of chaining forever.
    await expect(
      runOuraBackfillForUser("u1", () => false, 1, {
        sliceMs: 600_000,
        now: clock(),
      }),
    ).rejects.toThrow(/oura backfill incomplete/);
    expect(h.completedAt).toBeNull();
  });
});
