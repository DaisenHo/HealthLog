/**
 * Strava's rate limit and its detail budget.
 *
 *   - A 429 mid-walk used to discard everything the run had read: the error
 *     threw out of the walk before the upsert. The activities read before it
 *     land now, the cursor moves only as far as an oldest-first walk proves
 *     safe, the failure is booked as transient, and the backfill waits for
 *     the window Strava's headers name before it goes on.
 *   - An update mapped from the summary alone (detail budget spent, or a
 *     detail read that failed) wrote `totalEnergyKcal: null` over the
 *     calories an earlier detail read had stored. The fields only the detail
 *     carries are kept when this run did not read it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchActivities: vi.fn(),
  fetchActivityById: vi.fn(),
  annotate: vi.fn(),
  findUser: vi.fn(),
  updateUser: vi.fn(),
  updateManyUser: vi.fn(async (_arg: unknown) => ({ count: 1 })),
  createManyAndReturn: vi.fn(),
  updateWorkout: vi.fn(async (_arg: { data: Record<string, unknown> }) => ({})),
  findWorkout: vi.fn(),
  recordSyncFailure: vi.fn(async () => {}),
  recordSyncSuccess: vi.fn(async () => {}),
  isReauthRequired: vi.fn(async () => false),
  send: vi.fn(async (..._args: unknown[]) => "job-next"),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUser,
      updateMany: mocks.updateManyUser,
      update: mocks.updateUser,
    },
    workout: {
      createManyAndReturn: mocks.createManyAndReturn,
      update: mocks.updateWorkout,
      findUnique: mocks.findWorkout,
    },
  },
}));
vi.mock("@/lib/arrivals/workout-emit", () => ({
  emitInsertedWorkoutArrival: vi.fn(async () => {}),
}));
vi.mock("@/lib/cache/invalidate", () => ({
  invalidateUserMeasurements: vi.fn(),
}));
vi.mock("@/lib/logging/context", () => ({
  annotate: mocks.annotate,
  getEvent: () => ({ addWarning: vi.fn(), addExternalCall: vi.fn() }),
}));
vi.mock("@/lib/integrations/status", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/status")>()),
  recordSyncFailure: mocks.recordSyncFailure,
  recordSyncSuccess: mocks.recordSyncSuccess,
  isReauthRequired: mocks.isReauthRequired,
}));
vi.mock("../credentials", () => ({
  getStravaConnection: vi.fn(async () => ({
    accessToken: "access-token",
    refreshToken: "refresh-token",
    refreshTokenCiphertext: Buffer.from("ciphertext"),
  })),
  getStravaClientCredentials: vi.fn(),
  storeStravaTokens: vi.fn(),
}));
vi.mock("../client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../client")>()),
  fetchActivities: mocks.fetchActivities,
  fetchActivityById: mocks.fetchActivityById,
}));
vi.mock("@/lib/jobs/boss-instance", () => ({
  getGlobalBoss: vi.fn(() => ({ send: mocks.send })),
}));

import { runStravaBackfillForUser } from "@/lib/jobs/strava-backfill";
import { StravaApiError } from "../response-classifier";
import { stravaRateLimitRetryAfterSeconds } from "../client";
import { syncUserStrava } from "../sync";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 1);

function activity(id: number) {
  return {
    id,
    sport_type: "Run",
    start_date: new Date(T0 + id * HOUR).toISOString(),
    moving_time: 1800,
    elapsed_time: 1900,
    average_heartrate: 140,
  };
}

function rateLimited(retryAfterSeconds: number): StravaApiError {
  return new StravaApiError({
    verb: "fetchActivities",
    classification: "transient",
    httpStatus: 429,
    reason: "http_429",
    retryAfterSeconds,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUser.mockResolvedValue({
    stravaLastActivityAt: new Date(T0),
    stravaBackfillResumeBefore: null,
  });
  mocks.createManyAndReturn.mockImplementation(
    async ({ data }: { data: { externalId: string; startedAt: Date } }) => [
      { id: `w-${data.externalId}`, startedAt: data.startedAt },
    ],
  );
  mocks.fetchActivityById.mockImplementation(
    async (_t: string, id: number) => ({
      ...activity(id),
      calories: 300,
    }),
  );
});

describe("a 429 in the middle of a walk", () => {
  it("keeps what was read, moves the cursor an oldest-first walk proves, and books it transient", async () => {
    // An incremental walk (`after` set): Strava answers oldest first. Three
    // activities read, then the detail read of the fourth is refused.
    mocks.fetchActivities.mockResolvedValue([1, 2, 3, 4, 5].map(activity));
    mocks.fetchActivityById.mockImplementation(
      async (_t: string, id: number) => {
        if (id === 4) throw rateLimited(600);
        return { ...activity(id), calories: 300 };
      },
    );

    await expect(syncUserStrava("user-1")).resolves.toBe(3);

    expect(mocks.createManyAndReturn).toHaveBeenCalledTimes(3);
    expect(mocks.updateManyUser).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { stravaLastActivityAt: new Date(T0 + 3 * HOUR) },
      }),
    );
    expect(mocks.recordSyncFailure).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "transient", errorCode: "429" }),
    );
    expect(mocks.recordSyncSuccess).not.toHaveBeenCalled();
  });

  it("does not move the cursor past a newest-first walk it did not finish", async () => {
    mocks.fetchActivities.mockResolvedValue([9, 8, 7].map(activity));
    mocks.fetchActivityById.mockImplementation(
      async (_t: string, id: number) => {
        if (id === 7) throw rateLimited(600);
        return { ...activity(id), calories: 300 };
      },
    );

    await expect(syncUserStrava("user-1")).resolves.toBe(2);
    expect(mocks.updateManyUser).not.toHaveBeenCalled();
  });

  it("sends the next backfill run after the window Strava named", async () => {
    // A history walk (no `after`): newest first, refused on the second page.
    mocks.fetchActivities.mockImplementation(
      async (_t: string, q: { page: number }) => {
        if (q.page === 2) throw rateLimited(5400);
        return Array.from({ length: 100 }, (_, i) => activity(500 - i));
      },
    );

    const run = await runStravaBackfillForUser("user-1");

    expect(run).toEqual({ imported: 100, continued: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        stravaBackfillResumeBefore: new Date(T0 + 401 * HOUR + 1000),
      },
    });
    const [, , options] = mocks.send.mock.calls[0] as unknown as [
      string,
      unknown,
      { startAfter?: number },
    ];
    expect(options.startAfter).toBe(5400);
    expect(mocks.updateUser).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stravaBackfillCompletedAt: expect.any(Date),
        }),
      }),
    );
  });
});

describe("an update without the detail read", () => {
  it("keeps the stored calories, heart rate and description", async () => {
    // The row exists already; this run reads only the summary (no HR on it)
    // because the detail read failed.
    mocks.createManyAndReturn.mockResolvedValue([]);
    mocks.fetchActivities.mockResolvedValue([
      { ...activity(1), average_heartrate: undefined },
    ]);
    mocks.fetchActivityById.mockRejectedValue(new Error("detail down"));
    mocks.findWorkout.mockResolvedValue({
      metadata: { stravaName: "old", stravaDescription: "Hill reps" },
    });

    await syncUserStrava("user-1");

    const data = mocks.updateWorkout.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data).not.toHaveProperty("totalEnergyKcal");
    expect(data).not.toHaveProperty("avgHeartRate");
    expect(data).not.toHaveProperty("maxHeartRate");
    expect(data.metadata).toMatchObject({ stravaDescription: "Hill reps" });
    expect(data.durationSec).toBe(1800);
  });

  it("writes what a detail read returned, nulls included", async () => {
    mocks.createManyAndReturn.mockResolvedValue([]);
    mocks.fetchActivities.mockResolvedValue([activity(1)]);
    mocks.fetchActivityById.mockResolvedValue({
      ...activity(1),
      calories: null,
    });

    await syncUserStrava("user-1");

    const data = mocks.updateWorkout.mock.calls[0]![0].data as Record<
      string,
      unknown
    >;
    expect(data.totalEnergyKcal).toBeNull();
    expect(mocks.findWorkout).not.toHaveBeenCalled();
  });
});

describe("stravaRateLimitRetryAfterSeconds", () => {
  const at = new Date("2026-10-21T10:07:30Z");

  it("waits for the next quarter hour when the short window is spent", () => {
    const headers = new Headers({
      "X-RateLimit-Limit": "200,2000",
      "X-RateLimit-Usage": "200,950",
    });
    expect(stravaRateLimitRetryAfterSeconds(headers, at)).toBe(450);
  });

  it("waits for midnight UTC when the daily limit is spent", () => {
    const headers = new Headers({
      "X-ReadRateLimit-Limit": "100,1000",
      "X-ReadRateLimit-Usage": "40,1000",
    });
    expect(stravaRateLimitRetryAfterSeconds(headers, at)).toBe(
      13 * 3600 + 52 * 60 + 30,
    );
  });

  it("honours a Retry-After header when one is sent", () => {
    expect(
      stravaRateLimitRetryAfterSeconds(
        new Headers({ "Retry-After": "120" }),
        at,
      ),
    ).toBe(120);
  });

  it("falls back to the next quarter hour without any header", () => {
    expect(stravaRateLimitRetryAfterSeconds(new Headers(), at)).toBe(450);
  });
});
