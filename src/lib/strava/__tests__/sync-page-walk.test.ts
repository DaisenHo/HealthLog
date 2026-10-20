/**
 * The Strava activity walk runs through `walkPages`, and the backfill reads
 * its verdict (`integrations/page-walk.ts`): a walk that reaches its page
 * ceiling with a full page last is truncated, and the backfill leaves its
 * marker unset instead of stamping a history it did not finish. Before, the
 * loop stopped at forty pages and the backfill stamped the account complete.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchActivities: vi.fn(),
  annotate: vi.fn(),
  updateUser: vi.fn(),
  findUser: vi.fn(),
  isReauthRequired: vi.fn(),
  send: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: mocks.findUser,
      updateMany: vi.fn(async () => ({ count: 1 })),
      update: mocks.updateUser,
    },
    workout: {
      createManyAndReturn: vi.fn(async ({ data }) => [
        { id: `w-${data.externalId}`, startedAt: data.startedAt },
      ]),
      update: vi.fn(),
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
  getEvent: () => ({ addWarning: vi.fn() }),
}));
vi.mock("@/lib/integrations/status", () => ({
  recordSyncFailure: vi.fn(),
  recordSyncSuccess: vi.fn(),
  isReauthRequired: mocks.isReauthRequired,
  toFailureKind: vi.fn(() => "transient"),
  markSyncFailureRecorded: <T>(err: T) => err,
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
  // Summaries carry HR; the detail fetch only fills calories.
  fetchActivityById: vi.fn(async () => ({})),
}));
vi.mock("@/lib/jobs/boss-instance", () => ({
  getGlobalBoss: vi.fn(() => ({ send: mocks.send })),
}));

import { runStravaBackfillForUser } from "@/lib/jobs/strava-backfill";
import { syncUserStrava } from "../sync";

const PER_PAGE = 100;
const BACKFILL_MAX_PAGES = 40;

const HOUR = 3_600_000;
const T0 = Date.UTC(2020, 0, 1);

/** Activity `id` of a history; a higher id started later. */
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

/**
 * A history of `total` activities served as Strava serves a walk without
 * `after`: newest first, `before` (epoch seconds) cutting off the newer ones.
 */
function history(total: number) {
  mocks.fetchActivities.mockImplementation(
    async (
      _t: string,
      q: { page: number; perPage: number; before?: number },
    ) => {
      const ids = Array.from({ length: total }, (_, i) => total - i).filter(
        (id) => q.before === undefined || T0 + id * HOUR < q.before * 1000,
      );
      const from = (q.page - 1) * q.perPage;
      return ids.slice(from, from + q.perPage).map(activity);
    },
  );
}

function truncatedAnnotations() {
  return mocks.annotate.mock.calls.filter(
    ([e]) => e?.action?.name === "integration.page_walk.truncated",
  );
}

/** The resume point the user row holds, as the backfill writes it. */
let resumeBefore: Date | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  resumeBefore = null;
  mocks.isReauthRequired.mockResolvedValue(false);
  mocks.findUser.mockImplementation(async () => ({
    stravaLastActivityAt: null,
    stravaBackfillResumeBefore: resumeBefore,
  }));
  mocks.updateUser.mockImplementation(
    async ({
      data,
    }: {
      data: { stravaBackfillResumeBefore?: Date | null };
    }) => {
      if ("stravaBackfillResumeBefore" in data) {
        resumeBefore = data.stravaBackfillResumeBefore ?? null;
      }
      return { id: "user-1" };
    },
  );
  mocks.send.mockResolvedValue("job-next");
});

describe("Strava activity walk", () => {
  it("reads pages until a short one and stops there", async () => {
    history(2 * PER_PAGE + 7);

    await expect(syncUserStrava("user-1", { fullSync: true })).resolves.toBe(
      207,
    );
    expect(mocks.fetchActivities.mock.calls.map(([, q]) => q.page)).toEqual([
      1, 2, 3,
    ]);
    expect(truncatedAnnotations()).toEqual([]);
  });

  it("ends on an empty page without calling it truncated", async () => {
    history(PER_PAGE);

    await expect(syncUserStrava("user-1", { fullSync: true })).resolves.toBe(
      PER_PAGE,
    );
    expect(mocks.fetchActivities).toHaveBeenCalledTimes(2);
    expect(truncatedAnnotations()).toEqual([]);
  });

  it("reports a walk cut off at its ceiling", async () => {
    history((BACKFILL_MAX_PAGES + 5) * PER_PAGE);

    await syncUserStrava("user-1", { fullSync: true });

    expect(mocks.fetchActivities).toHaveBeenCalledTimes(BACKFILL_MAX_PAGES);
    expect(truncatedAnnotations()).toEqual([
      [
        expect.objectContaining({
          meta: {
            walk: "strava.activities",
            pages: BACKFILL_MAX_PAGES,
            reason: "ceiling",
          },
        }),
      ],
    ]);
  });
});

describe("Strava backfill verdict", () => {
  it("stamps the marker when the walk reached the start of the history", async () => {
    history(3 * PER_PAGE - 1);

    await expect(runStravaBackfillForUser("user-1")).resolves.toEqual({
      imported: 3 * PER_PAGE - 1,
      continued: false,
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: {
        stravaBackfillCompletedAt: expect.any(Date),
        stravaBackfillResumeBefore: null,
      },
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("records where a cut-off walk got to and sends the next run after the rate window", async () => {
    history((BACKFILL_MAX_PAGES + 1) * PER_PAGE);

    await expect(runStravaBackfillForUser("user-1")).resolves.toEqual({
      imported: BACKFILL_MAX_PAGES * PER_PAGE,
      continued: true,
    });
    // The oldest activity read is id 101; the next run asks for those before.
    expect(resumeBefore).toEqual(new Date(T0 + 101 * HOUR + 1000));
    expect(mocks.updateUser).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stravaBackfillCompletedAt: expect.any(Date),
        }),
      }),
    );
    expect(mocks.send).toHaveBeenCalledWith(
      "integration-backfill-admission",
      expect.objectContaining({
        kind: "strava-backfill",
        data: expect.objectContaining({ userId: "user-1", slice: 1 }),
      }),
      expect.objectContaining({ startAfter: 15 * 60 }),
    );
    expect(mocks.annotate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ name: "strava.backfill.truncated" }),
      }),
    );
  });

  it("goes on from the recorded place instead of the newest page, and finishes", async () => {
    const total = (BACKFILL_MAX_PAGES + 10) * PER_PAGE;
    history(total);

    await runStravaBackfillForUser("user-1");
    const firstRun = mocks.fetchActivities.mock.calls.length;
    mocks.fetchActivities.mockClear();
    await expect(runStravaBackfillForUser("user-1", 1)).resolves.toEqual({
      imported: 10 * PER_PAGE + 1,
      continued: false,
    });

    expect(firstRun).toBe(BACKFILL_MAX_PAGES);
    // Every page of the second run asked for activities before the place
    // the first one recorded (the oldest it read was id 1001), and the walk
    // ended at the oldest activity.
    const queries = mocks.fetchActivities.mock.calls.map(([, q]) => q);
    expect(new Set(queries.map((q) => q.before))).toEqual(
      new Set([(T0 + 1001 * HOUR) / 1000 + 1]),
    );
    expect(queries.length).toBe(11);
    expect(resumeBefore).toBeNull();
    expect(mocks.updateUser).toHaveBeenLastCalledWith({
      where: { id: "user-1" },
      data: {
        stravaBackfillCompletedAt: expect.any(Date),
        stravaBackfillResumeBefore: null,
      },
    });
  });

  it("records nothing and sends nothing when a run got no further than the last", async () => {
    history((BACKFILL_MAX_PAGES + 1) * PER_PAGE);
    // A place older than anything the walk can read past: the provider kept
    // handing back the same newest pages.
    mocks.fetchActivities.mockImplementation(async (_t, q) =>
      Array.from({ length: PER_PAGE }, (_, i) =>
        activity(5_000 - (q.page - 1) * PER_PAGE - i),
      ),
    );
    resumeBefore = new Date(T0);

    await expect(runStravaBackfillForUser("user-1")).resolves.toEqual({
      imported: BACKFILL_MAX_PAGES * PER_PAGE,
      continued: false,
    });
    expect(resumeBefore).toEqual(new Date(T0));
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("returns without walking or stamping while the connection waits for re-authorisation", async () => {
    mocks.isReauthRequired.mockResolvedValue(true);
    history(PER_PAGE);

    await expect(runStravaBackfillForUser("user-1")).resolves.toEqual({
      imported: 0,
      continued: false,
    });
    expect(mocks.fetchActivities).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
