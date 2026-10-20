/**
 * One heavy job at a time per process.
 *
 * The queues in `HEAVY_QUEUES` each hold a large working set in the heap while
 * they run: an export being parsed, a whole account being restored or
 * serialised, a provider pass over every account. Web and worker share one
 * process and one heap limit, and these jobs used to run side by side when
 * their schedules or a person's upload happened to meet, so the peak was the
 * sum of whatever overlapped rather than the largest one. Under the lane a
 * heavy job waits for the one before it, first come first served.
 *
 * The lane lives in the process, not the database: the heap it protects is
 * the process's own, and another process has a heap of its own.
 *
 * A job waits until its turn or until pg-boss gives up on it. At the job's
 * expiry pg-boss aborts its signal and applies the queue's retry policy, so a
 * waiter that sees the abort leaves the line without running and reports
 * `lane_expired`; the retry takes its place. A queue bound with `lockedPass`
 * holds that lock outside the lane, so the retry finds the lock taken while
 * the original still waits instead of queueing a second time
 * (`heavy-lane-guard.test.ts`). The exception is a one-shot: its input lives
 * outside pg-boss (a staged upload, a restore row) and nothing retries it, so
 * it keeps its place past the expiry and runs when its turn comes, as pg-boss
 * lets a handler do.
 */
import type { Job } from "pg-boss";

import { jobDone, type JobOutcome } from "@/lib/jobs/job-outcome";
import { annotate } from "@/lib/logging/context";

export interface HeavyQueue {
  /** What makes the job heavy. */
  why: string;
  /** A one-shot keeps its place past its expiry; see the module note. */
  oneShot?: true;
}

/** The queues that take the lane. */
export const HEAVY_QUEUES: Readonly<Record<string, HeavyQueue>> = {
  "apple-health-import-v2": {
    why: "Parses an export of up to several gigabytes.",
    oneShot: true,
  },
  "health-connect-import": {
    why: "Reads a Health Connect export database.",
    oneShot: true,
  },
  "backup-restore": {
    why: "Holds a batch of a whole account's readings per insert.",
    oneShot: true,
  },
  "data-backup": { why: "Serialises every account's whole record." },
  "data-backup-offhost": {
    why: "Serialises and uploads every account's record.",
  },
  "data-restore-drill": {
    why: "Stream-parses every account's newest off-host object.",
  },
  "rollup-full-backfill": {
    why: "Folds five years of one account's readings into buckets.",
  },
  "insights-general-status": {
    why: "Builds every status snapshot for every account, a provider call each.",
  },
  "insight-pregenerate": {
    why: "The nightly walk: a comprehensive snapshot and generation per account.",
  },
  "period-narrative-warm": {
    why: "The boundary-night walk: a narrative per account and period.",
  },
};

type Waiter = () => void;

const NEVER = new AbortController().signal;

const waiting: Waiter[] = [];
let busy = false;

/** Resolves true once the lane is ours, false if `signal` aborts first. */
function enter(signal: AbortSignal): Promise<boolean> {
  if (!busy) {
    busy = true;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const onAbort = () => {
      const at = waiting.indexOf(grant);
      if (at >= 0) waiting.splice(at, 1);
      resolve(false);
    };
    const grant: Waiter = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    };
    if (signal.aborted) return resolve(false);
    signal.addEventListener("abort", onAbort, { once: true });
    waiting.push(grant);
  });
}

function leave(): void {
  const next = waiting.shift();
  if (next) next();
  else busy = false;
}

/**
 * Wrap `handler` so the jobs of `queue` run in the lane. `inLane` picks the
 * jobs that are heavy where a queue carries light ones too (a single
 * account's warm beside the nightly walk); a batch with none of them runs at
 * once.
 */
export function heavyLane<J extends Job<unknown>>(
  queue: string,
  handler: (jobs: J[]) => Promise<JobOutcome>,
  inLane: (job: J) => boolean = () => true,
): (jobs: J[]) => Promise<JobOutcome> {
  const heavy = HEAVY_QUEUES[queue];
  if (!heavy) throw new Error(`heavyLane: ${queue} is not in HEAVY_QUEUES`);
  return async (jobs) => {
    if (!jobs.some(inLane)) return handler(jobs);
    const queuedAt = Date.now();
    const entered = await enter(
      heavy.oneShot ? NEVER : AbortSignal.any(signalsOf(jobs)),
    );
    const waitedMs = Date.now() - queuedAt;
    annotate({
      action: {
        name: entered ? "job.heavy_lane.entered" : "job.heavy_lane.expired",
      },
      meta: { queue, waited_ms: waitedMs },
    });
    if (!entered) return jobDone({ lane_expired: jobs.length });
    try {
      return await handler(jobs);
    } finally {
      leave();
    }
  };
}

function signalsOf(jobs: readonly Job<unknown>[]): AbortSignal[] {
  return jobs.flatMap((job) => (job.signal ? [job.signal] : []));
}
