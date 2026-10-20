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
  isReauthRequired: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ stravaLastActivityAt: null })),
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
  getGlobalBoss: vi.fn(() => null),
}));

import { runStravaBackfillForUser } from "@/lib/jobs/strava-backfill";
import { syncUserStrava } from "../sync";

const PER_PAGE = 100;
const BACKFILL_MAX_PAGES = 40;

/** A page of `n` activities; ids continue across pages. */
function page(pageNo: number, n: number) {
  return Array.from({ length: n }, (_, i) => {
    const id = (pageNo - 1) * PER_PAGE + i + 1;
    return {
      id,
      sport_type: "Run",
      start_date: new Date(Date.UTC(2020, 0, 1) + id * 3_600_000).toISOString(),
      moving_time: 1800,
      elapsed_time: 1900,
      average_heartrate: 140,
    };
  });
}

/** A history of `total` activities, served page by page. */
function history(total: number) {
  mocks.fetchActivities.mockImplementation(
    async (_t: string, q: { page: number; perPage: number }) => {
      const remaining = total - (q.page - 1) * q.perPage;
      return page(q.page, Math.max(0, Math.min(q.perPage, remaining)));
    },
  );
}

function truncatedAnnotations() {
  return mocks.annotate.mock.calls.filter(
    ([e]) => e?.action?.name === "integration.page_walk.truncated",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isReauthRequired.mockResolvedValue(false);
  mocks.updateUser.mockResolvedValue({ id: "user-1" });
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
    });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { stravaBackfillCompletedAt: expect.any(Date) },
    });
  });

  it("leaves the marker unset, without a retry, when the walk was cut off", async () => {
    history((BACKFILL_MAX_PAGES + 1) * PER_PAGE);

    await expect(runStravaBackfillForUser("user-1")).resolves.toEqual({
      imported: BACKFILL_MAX_PAGES * PER_PAGE,
    });
    expect(mocks.updateUser).not.toHaveBeenCalled();
    expect(mocks.annotate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ name: "strava.backfill.truncated" }),
      }),
    );
  });

  it("returns without walking or stamping while the connection waits for re-authorisation", async () => {
    mocks.isReauthRequired.mockResolvedValue(true);
    history(PER_PAGE);

    await expect(runStravaBackfillForUser("user-1")).resolves.toEqual({
      imported: 0,
    });
    expect(mocks.fetchActivities).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
