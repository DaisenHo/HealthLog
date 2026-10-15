/**
 * The hourly Google Health job runs under pg-boss's fifteen-minute expiry.
 * An account whose backfill slice holds it can make the job wait eight of
 * those minutes, and the sync after the wait used to run as long as it
 * needed: past the expiry pg-boss marked the job failed and retried it beside
 * the run still going. The pass now spends only the job's budget: the lock
 * wait is capped at what is left, the sync is handed the budget and stops
 * cleanly when it runs out, and an account reached after that is left for the
 * next hour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { syncUserGoogleHealth, connections } = vi.hoisted(() => ({
  syncUserGoogleHealth: vi.fn(),
  connections: [] as Array<{ userId: string }>,
}));

vi.mock("@/lib/google-health/sync", () => ({
  GOOGLE_HEALTH_POLL_CONCURRENCY: 1,
  isGoogleHealthParked: vi.fn(async () => false),
  syncUserGoogleHealth,
}));
vi.mock("../shared", () => ({
  getWorkerPrisma: () => ({
    googleHealthConnection: { findMany: vi.fn(async () => connections) },
  }),
}));
vi.mock("@/lib/jobs/reminder-satisfy", () => ({
  enqueueReminderSatisfy: vi.fn(async () => {}),
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));

import type { Job } from "pg-boss";
import { handleGoogleHealthSync } from "../google-health-sync";
import { JOB_BUDGET_SHARE } from "@/lib/jobs/job-budget";
import { GOOGLE_HEALTH_POLL_LOCK_WAIT_MS } from "@/lib/google-health/sync-lock";

const START = new Date("2026-10-15T10:00:00.000Z").getTime();
const EXPIRY_S = 15 * 60;
const BUDGET_MS = EXPIRY_S * 1000 * JOB_BUDGET_SHARE;

function cronJob(): Job<{ userId?: string }> {
  return {
    id: "tick",
    name: "google-health-sync",
    data: {},
    expireInSeconds: EXPIRY_S,
  } as unknown as Job<{ userId?: string }>;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  syncUserGoogleHealth.mockReset();
  connections.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the hourly Google Health job and its expiry", () => {
  it("hands the sync what is left of the budget after the lock wait, and stops it there", async () => {
    connections.push({ userId: "waited" }, { userId: "late" });
    const seen: Array<{ beforeEnd: boolean; atEnd: boolean }> = [];
    syncUserGoogleHealth.mockImplementation(
      async (_userId: string, opts: { shouldStop: () => boolean }) => {
        // Eight minutes waiting for the backfill slice to let go.
        vi.setSystemTime(START + GOOGLE_HEALTH_POLL_LOCK_WAIT_MS);
        const beforeEnd = opts.shouldStop();
        // The walk runs on until the budget is spent, and is told to stop.
        vi.setSystemTime(START + BUDGET_MS);
        seen.push({ beforeEnd, atEnd: opts.shouldStop() });
        return {
          state: "truncated",
          imported: 120,
          failed: true,
          resources: [],
        };
      },
    );

    const outcome = await handleGoogleHealthSync([cronJob()]);

    expect(syncUserGoogleHealth).toHaveBeenCalledTimes(1);
    expect(syncUserGoogleHealth.mock.calls[0]![1]).toMatchObject({
      waitForLockMs: GOOGLE_HEALTH_POLL_LOCK_WAIT_MS,
    });
    expect(seen).toEqual([{ beforeEnd: false, atEnd: true }]);
    // A stop on the budget is the next hour's work, not a failure to retry;
    // the account after it waits for the next hour.
    expect(outcome.did).toMatchObject({
      users_partial: 1,
      users_skipped: 1,
      users_failed: 0,
      users_retryable: 0,
    });
  });

  it("never waits for the lock past the budget", async () => {
    connections.push({ userId: "a" }, { userId: "b" });
    syncUserGoogleHealth
      .mockImplementationOnce(async () => {
        // The first account takes most of the budget.
        vi.setSystemTime(START + BUDGET_MS - 60_000);
        return { state: "complete", imported: 1, failed: false, resources: [] };
      })
      .mockImplementationOnce(async () => ({
        state: "complete",
        imported: 1,
        failed: false,
        resources: [],
      }));

    await handleGoogleHealthSync([cronJob()]);

    expect(syncUserGoogleHealth).toHaveBeenCalledTimes(2);
    expect(syncUserGoogleHealth.mock.calls[1]![1]).toMatchObject({
      waitForLockMs: 60_000,
    });
  });
});
