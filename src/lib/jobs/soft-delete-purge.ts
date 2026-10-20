/**
 * Nightly purge of expired tombstones for every soft-delete model the
 * register hands to it (`SOFT_DELETE_RETENTION`, kind `purge`).
 *
 * One leg per table, one table after the other: the tables are small next to
 * the sync domains, and the job has the night. A leg that stops at its batch
 * cap, or leaves an account under restore for the next night, says so in the
 * run report rather than looking like a night with nothing to do.
 */
import type { Job } from "pg-boss";

import { jobDone, type JobOutcome } from "@/lib/jobs/job-outcome";
import { getWorkerPrisma } from "@/lib/jobs/reminder/shared";
import { purgeSoftDeletedRows } from "@/lib/jobs/soft-delete-retention";
import { withBackgroundEvent } from "@/lib/logging/background";

export const SOFT_DELETE_PURGE_QUEUE = "soft-delete-purge";
/** Daily at 03:42 Europe/Berlin, after the sync-domain tombstone cleanup. */
export const SOFT_DELETE_PURGE_CRON = "42 3 * * *";

export interface SoftDeletePurgePayload {
  triggeredAt?: string;
}

export async function handleSoftDeletePurge(
  jobs: Job<SoftDeletePurgePayload>[],
): Promise<JobOutcome> {
  void jobs;
  return withBackgroundEvent("job.soft_delete_purge", async (evt) => {
    try {
      const legs = await purgeSoftDeletedRows(getWorkerPrisma());
      const deleted = legs.reduce((sum, leg) => sum + leg.deleted, 0);
      const drained = legs.every((leg) => leg.drained);
      const deferredAccounts = Math.max(
        0,
        ...legs.map((leg) => leg.deferredAccounts),
      );
      evt.addMeta("soft_delete_purge_deleted", deleted);
      evt.addMeta("soft_delete_purge_drained", drained);
      evt.addMeta("soft_delete_purge_deferred_accounts", deferredAccounts);
      for (const leg of legs) {
        if (leg.deleted > 0) {
          evt.addMeta(`soft_delete_purge_${leg.table}`, leg.deleted);
        }
      }
      if (!drained) {
        evt.addWarning(
          "soft-delete-purge stopped at the batch cap; a backlog remains for the next run",
        );
      }
      return jobDone({
        deleted,
        drained,
        deferred_accounts: deferredAccounts,
      });
    } catch (err) {
      // Rethrow, as the sync-domain purge does: a retention purge that fails
      // quietly every night looks exactly like one with nothing to do.
      evt.addWarning(`soft-delete-purge failed: ${err}`);
      throw err;
    }
  });
}
