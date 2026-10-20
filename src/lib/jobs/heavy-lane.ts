/**
 * One heavy job at a time per process.
 *
 * The queues in `HEAVY_QUEUES` each hold a large working set in the heap while
 * they run: an export being parsed, a whole account being restored or
 * serialised, a provider pass over every account. Web and worker share one
 * process and one heap limit, and these jobs used to run side by side when
 * their schedules or a person's upload happened to meet, so the peak was the
 * sum of whatever overlapped rather than the largest one. Under the lane a
 * heavy job runs only while no other heavy job does.
 *
 * The lane lives in the process, not the database: the heap it protects is
 * the process's own, and another process has a heap of its own.
 *
 * A job that arrives while the lane is taken does not wait in the handler. It
 * goes back to the queue (`deferLaneJobs`): its row returns to `created` with
 * `start_after` a little ahead, the claim cleared so the next fetch does not
 * count an attempt, and pg-boss's completion of the handler then finds no
 * active row and leaves it alone. Waiting in the handler instead ran the
 * job's expiry down while it stood in line, because pg-boss counts the expiry
 * from the fetch and ends the handler at it: a six-hour import let a
 * two-hour backup expire through all its retries, and an upload that waited
 * longer than its own expiry was failed, stopped counting as in use, and had
 * its staged file swept from under it. A deferred job keeps its id, its
 * retries and its staged upload, and its expiry starts when it runs.
 */
import type { Job } from "pg-boss";

import { prisma } from "@/lib/db";
import { jobDone, type JobOutcome } from "@/lib/jobs/job-outcome";
import { annotate } from "@/lib/logging/context";

export interface HeavyQueue {
  /** What makes the job heavy. */
  why: string;
}

/** The queues that take the lane. */
export const HEAVY_QUEUES: Readonly<Record<string, HeavyQueue>> = {
  "apple-health-import-v2": {
    why: "Parses an export of up to several gigabytes.",
  },
  "health-connect-import": {
    why: "Reads a Health Connect export database.",
  },
  "backup-restore": {
    why: "Holds a batch of a whole account's readings per insert.",
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
  "integration-backfill-admission": {
    why: "A provider's full history for one account, page by page; the Google Health import is the largest heap in the tree.",
  },
};

/** How far ahead a deferred job is put back in the queue. */
export const LANE_DEFER_SECONDS = 60;

/**
 * Put `jobs` of `queue` back in the queue to run `seconds` from now. The same
 * reset pg-boss's own `restore()` makes, with `start_after` moved in the same
 * statement: a restore followed by a separate update leaves a moment in which
 * another fetch could claim the row, and the completion of this handler would
 * then settle that newer claim, since a restored job's next claim keeps its
 * attempt number. Answers how many rows went back.
 */
export async function deferLaneJobs(
  queue: string,
  jobs: readonly Job<unknown>[],
  seconds: number = LANE_DEFER_SECONDS,
): Promise<number> {
  const ids = jobs.map((job) => job.id);
  return prisma.$executeRaw`
    UPDATE pgboss.job
    SET state = 'created',
        started_on = NULL,
        heartbeat_on = NULL,
        upsert_by_key = NULL,
        start_after = now() + make_interval(secs => ${seconds}::int)
    WHERE name = ${queue}
      AND id = ANY(${ids}::uuid[])
      AND state = 'active'
  `;
}

let busy = false;

/**
 * Wrap `handler` so the jobs of `queue` run in the lane. `inLane` picks the
 * jobs that are heavy where a queue carries light ones too (a single
 * account's warm beside the nightly walk); a batch with none of them runs at
 * once. `defer` is the way back to the queue; tests replace it.
 */
export function heavyLane<J extends Job<unknown>>(
  queue: string,
  handler: (jobs: J[]) => Promise<JobOutcome>,
  inLane: (job: J) => boolean = () => true,
  defer: (queue: string, jobs: readonly J[]) => Promise<number> = deferLaneJobs,
): (jobs: J[]) => Promise<JobOutcome> {
  if (!HEAVY_QUEUES[queue]) {
    throw new Error(`heavyLane: ${queue} is not in HEAVY_QUEUES`);
  }
  return async (jobs) => {
    if (!jobs.some(inLane)) return handler(jobs);
    if (busy) {
      const deferred = await defer(queue, jobs);
      annotate({
        action: { name: "job.heavy_lane.deferred" },
        meta: { queue, jobs: jobs.length, deferred },
      });
      return jobDone({ lane_deferred: deferred });
    }
    busy = true;
    annotate({ action: { name: "job.heavy_lane.entered" }, meta: { queue } });
    try {
      return await handler(jobs);
    } finally {
      busy = false;
    }
  };
}
