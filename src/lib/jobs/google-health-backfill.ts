/**
 * v1.26.0 — pg-boss queue + boot-time self-converging backfill for newly
 * connected Google Health accounts. Modelled on the Fitbit / WHOOP backfill
 * (`src/lib/jobs/fitbit-backfill.ts`): a discovery query enqueues one job per
 * connection that has NOT yet been backfilled, and the pass is idempotent
 * across reboots (the predicate `backfill_completed_at IS NULL` drops a
 * connection once its backfill finishes).
 *
 * The queue name MUST be registered in `allQueues` in
 * `src/lib/jobs/reminder/register-integration-sync.ts` or pg-boss never
 * provisions it and the boot enqueue silently never drains (the v1.4.37
 * dead-queue class).
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { annotate } from "@/lib/logging/context";
import { getGlobalBoss } from "@/lib/jobs/boss-instance";
import {
  enqueueIntegrationBackfillAdmission,
  INTEGRATION_BACKFILL_CONTINUATION_DELAY_SECONDS,
  integrationBackfillSourceOptions,
} from "@/lib/jobs/integration-backfill-admission";
import {
  readGoogleHealthBackfillCursors,
  readGoogleHealthBackfillDone,
  runWithGoogleHealthBackfillResume,
} from "@/lib/google-health/sync-core";
import {
  isGoogleHealthParked,
  syncUserGoogleHealth,
} from "@/lib/google-health/sync";
import { GOOGLE_HEALTH_SYNC_LOCK_WAIT_MS } from "@/lib/google-health/sync-lock";
import {
  googleHealthSliceBudget,
  runWithGoogleHealthStop,
} from "@/lib/google-health/client";
import { GOOGLE_HEALTH_RESUMABLE_PAGE_CEILING } from "@/lib/google-health/sync-metrics";
import { reportJobProgress } from "@/lib/jobs/job-observer";
import { GOOGLE_HEALTH_COLLECTION_KEYS } from "@/lib/google-health/collection-keys";

export const GOOGLE_HEALTH_BACKFILL_QUEUE = "google-health-backfill";

/**
 * Serial concurrency — a backfill walks years of history for one account and is
 * rate-bounded by Google's per-app quota; concurrency-1 keeps it from crowding
 * the request pool, matching `FITBIT_BACKFILL_CONCURRENCY`.
 */
export const GOOGLE_HEALTH_BACKFILL_CONCURRENCY = 1;

/**
 * One slice of a backfill: how long it walks and how many pages it reads
 * before it lets go of the account and hands the rest to the next slice.
 *
 * Far inside the admission job's expiry (sixteen hours) on purpose. A slice
 * holds the account's sync lock while it walks, and the hourly sync of that
 * account waits for the lock (`GOOGLE_HEALTH_POLL_LOCK_WAIT_MS`), so a slice
 * has to be short enough for the hourly sync to get its turn: before slices,
 * one attempt held the lock for as long as the import ran and every hourly
 * sync of the account in that time was skipped. The page budget keeps a
 * slice on a fast link from spending a whole quota window in one go.
 */
export const GOOGLE_HEALTH_BACKFILL_SLICE_MS = 5 * 60 * 1000;
export const GOOGLE_HEALTH_BACKFILL_SLICE_PAGES = 500;

/**
 * The pause before the next slice when this one ended on a rate limit it
 * could not wait out: long enough for Google's per-minute window to refill
 * several times over, so the next slice does not open on the same 429.
 */
export const GOOGLE_HEALTH_BACKFILL_THROTTLED_DELAY_SECONDS = 5 * 60;

/**
 * The highest slice a backfill chain may reach, derived from the work a
 * backfill can do rather than guessed.
 *
 * A slice is continued only when it made progress that is on disk: it
 * finished a collection, or it moved a resumable collection's edge after
 * writing at least one page. Collections finish once each, and a resumable
 * collection's pages are capped across all attempts by its page ceiling
 * (`GOOGLE_HEALTH_RESUMABLE_PAGE_CEILING`, the sum of them). So no chain of
 * progressing slices is longer than the collections plus those pages; the two
 * extra are slack for the first slice and the one that stamps the marker. In
 * practice a chain is a handful of slices per year of dense history. A slice
 * past this is counting progress it does not make, and fails rather than
 * queueing another.
 */
export const GOOGLE_HEALTH_BACKFILL_MAX_SLICE =
  GOOGLE_HEALTH_COLLECTION_KEYS.length +
  GOOGLE_HEALTH_RESUMABLE_PAGE_CEILING +
  2;

/** Test seam: a slice's budget, when not the production one. */
export interface GoogleHealthBackfillSliceOptions {
  sliceMs?: number;
  slicePages?: number;
}

export interface GoogleHealthBackfillPayload {
  userId: string;
  enqueuedAt: string;
}

/**
 * Per-user backfill handler. Runs one slice of a full-history sync for one
 * account and stamps `backfillCompletedAt` ONLY on a clean run, so the
 * discovery query drops it. Idempotent: the per-resource upserts are
 * key-stable, so a re-run (e.g. a reboot mid-walk) overwrites rather than
 * duplicating. Mirrors `runFitbitBackfillForUser`.
 *
 * Verdict-gated: a partial hard failure (one collection 400ing, a write
 * failing) is not complete, and stamping the marker over a partial walk would
 * freeze the gap in forever. A connection parked at `error_reauth` is NOT
 * clean either, but throwing against a dead grant would just burn the retry
 * budget on the same no-op: return WITHOUT stamping — the boot discovery
 * re-enqueues the account on the next boot, and the stamp lands once the user
 * reconnects and a clean walk completes.
 *
 * Resumable at two grains (`GoogleHealthBackfillCursor`): every collection the
 * walk finishes cleanly is noted in `backfillProgress.done` and skipped from
 * then on, and every spot-reading collection notes the edge it has written up
 * to after each page, so the next attempt starts there instead of at the
 * newest page. The note is cleared once the stamp lands, and on every
 * reconnect.
 *
 * Runs in slices. A slice walks until its own budget is spent
 * (`GOOGLE_HEALTH_BACKFILL_SLICE_MS` / `_PAGES`), Google throttles it past
 * what a wait covers, or the job's budget (`shouldStop`) runs out, and then
 * lets go of the account. A slice that made progress on disk (a collection
 * finished, an edge moved) is not a failure: it sends the next slice
 * (`slice + 1`) and returns `continued`, without the error line or the
 * queue's failure count. Only a slice that moved nothing throws, with what
 * each collection came to in the message, because that one is stuck: the
 * pg-boss retry and, after it, the next boot take it from there. The chain is
 * capped at `GOOGLE_HEALTH_BACKFILL_MAX_SLICE`.
 *
 * What the slice did is annotated on the run's event as
 * `googleHealth.backfill.slice` (see `docs/integrations/google-health.md`).
 *
 * Never beside another run of the same account: the sync takes the account's
 * lock, waiting a bounded time for an hourly or manual run to finish. If the
 * lock does not come free the attempt throws without doing anything, and the
 * retry tries again.
 */
export async function runGoogleHealthBackfillForUser(
  userId: string,
  shouldStop: () => boolean = () => false,
  slice: number = 0,
  sliceOptions: GoogleHealthBackfillSliceOptions = {},
): Promise<{ imported: number; continued?: boolean }> {
  if (slice > GOOGLE_HEALTH_BACKFILL_MAX_SLICE) {
    annotate({
      action: {
        name: "google_health.backfill.slice_ceiling",
        details: { slice, maxSlice: GOOGLE_HEALTH_BACKFILL_MAX_SLICE },
      },
    });
    throw new Error(
      `google-health backfill for user ${userId} reached slice ${slice}, past the ceiling of ${GOOGLE_HEALTH_BACKFILL_MAX_SLICE}`,
    );
  }
  if (await isGoogleHealthParked(userId)) {
    annotate({
      action: {
        name: "google_health.backfill.skipped_reauth",
        details: { imported: 0 },
      },
    });
    return { imported: 0 };
  }

  const connection = await prisma.googleHealthConnection.findUnique({
    where: { userId },
    select: { backfillProgress: true, backfillCompletedAt: true },
  });
  if (connection?.backfillCompletedAt) {
    // A slice queued behind the one that finished the import, or a boot
    // delivery that raced it: the history is in, nothing to walk again.
    annotate({
      action: {
        name: "google_health.backfill.already_complete",
        details: { slice },
      },
    });
    return { imported: 0 };
  }
  const done = readGoogleHealthBackfillDone(connection?.backfillProgress);
  const cursors = readGoogleHealthBackfillCursors(connection?.backfillProgress);
  const doneBefore = done.size;

  const budget = googleHealthSliceBudget(
    sliceOptions.sliceMs ?? GOOGLE_HEALTH_BACKFILL_SLICE_MS,
    sliceOptions.slicePages ?? GOOGLE_HEALTH_BACKFILL_SLICE_PAGES,
  );
  const startedAt = Date.now();
  const {
    result: { imported, failed, busy },
    skipped,
    advanced,
    collections,
  } = await runWithGoogleHealthBackfillResume(
    userId,
    done,
    () =>
      runWithGoogleHealthStop(
        shouldStop,
        () =>
          syncUserGoogleHealth(userId, {
            fullSync: true,
            waitForLockMs: GOOGLE_HEALTH_SYNC_LOCK_WAIT_MS,
          }),
        budget,
      ),
    cursors,
  );

  const finished = done.size - doneBefore;
  const sliceReport = {
    slice,
    elapsedMs: Date.now() - startedAt,
    pages: budget.pages,
    stopReason: budget.stopReason,
    imported,
    collectionsDone: done.size,
    collectionsTotal: GOOGLE_HEALTH_COLLECTION_KEYS.length,
    collectionsFinished: finished,
    resumedPast: skipped.length,
    collections,
    // Where each unfinished resumable collection has got to, after this slice.
    edges: Object.fromEntries([...cursors].map(([key, c]) => [key, c.at])),
  };
  annotate({ meta: { "googleHealth.backfill.slice": sliceReport } });
  reportJobProgress({
    google_health_backfill_slice: slice,
    google_health_backfill_pages: budget.pages,
    google_health_backfill_collections_done: done.size,
  });

  if (busy) {
    throw new Error(
      `google-health backfill for user ${userId} deferred: another sync of the account is running`,
    );
  }

  if (failed) {
    // Progress is what this slice put on disk: collections finished, and
    // edges moved. Either is enough to go on; neither means stuck.
    const progressed = finished > 0 || advanced.size > 0;
    if (progressed && slice + 1 <= GOOGLE_HEALTH_BACKFILL_MAX_SLICE) {
      const boss = getGlobalBoss();
      const sent = boss
        ? await enqueueIntegrationBackfillAdmission(
            boss,
            {
              kind: "google-health-backfill",
              data: {
                userId,
                enqueuedAt: new Date().toISOString(),
                slice: slice + 1,
              },
            },
            budget.stopReason === "rate_limited"
              ? GOOGLE_HEALTH_BACKFILL_THROTTLED_DELAY_SECONDS
              : INTEGRATION_BACKFILL_CONTINUATION_DELAY_SECONDS,
          )
        : null;
      if (sent) {
        annotate({
          action: {
            name: "google_health.backfill.continued",
            details: {
              imported,
              slice,
              stopReason: budget.stopReason,
              collectionsFinished: finished,
              collectionsDone: done.size,
              edgesMoved: [...advanced.keys()],
            },
          },
        });
        return { imported, continued: true };
      }
      // No follow-up could be queued; fall through to the retry path so the
      // work is not dropped.
    }
    // Nothing moved in this slice: the backfill is stuck, not slow. Surface
    // through the pg-boss retry path (retryLimit 3, backoff) with what each
    // collection came to, so the log line says where it is stuck. If the
    // failure parked the connection at error_reauth meanwhile, the next
    // attempt takes the reauth return above instead of failing again.
    annotate({
      action: {
        name: "google_health.backfill.stuck",
        details: { slice, stopReason: budget.stopReason },
      },
    });
    const where = collections
      .filter((c) => c.status !== "done")
      .map((c) => `${c.key}:${c.status}`)
      .join(",");
    throw new Error(
      `google-health backfill incomplete for user ${userId} — marker not stamped (no progress in slice ${slice}${budget.stopReason ? `, stopped on ${budget.stopReason}` : ""}${where ? `; ${where}` : ""})`,
    );
  }

  await prisma.googleHealthConnection.update({
    where: { userId },
    data: { backfillCompletedAt: new Date(), backfillProgress: Prisma.DbNull },
  });

  annotate({
    action: {
      name: "google_health.backfill.complete",
      details: { imported, slice },
    },
  });
  return { imported };
}

/**
 * Boot-time discovery. Finds every Google Health connection not yet backfilled
 * (`backfill_completed_at IS NULL`) and enqueues one backfill job per account.
 *
 * Idempotent across reboots: once a connection's backfill completes,
 * `backfillCompletedAt` is set and the predicate drops it from the discovery
 * set. pg-boss `singletonKey` coalesces duplicate sends so a fast restart while
 * a job is queued doesn't double up.
 *
 * Best-effort: errors are returned through the result value so the worker boot
 * never fails because of a backfill miss.
 */
export async function enqueueBootTimeGoogleHealthBackfill(
  startAfterSeconds: number = 0,
): Promise<{
  enqueued: number;
  skipped: number;
  error: string | null;
}> {
  const boss = getGlobalBoss();
  if (!boss) {
    return { enqueued: 0, skipped: 0, error: null };
  }

  try {
    const connections = await prisma.googleHealthConnection.findMany({
      where: { backfillCompletedAt: null },
      select: { userId: true },
    });

    if (connections.length === 0) {
      return { enqueued: 0, skipped: 0, error: null };
    }

    let enqueued = 0;
    let skipped = 0;
    for (const { userId } of connections) {
      const payload: GoogleHealthBackfillPayload = {
        userId,
        enqueuedAt: new Date().toISOString(),
      };
      const jobId = await boss.send(
        GOOGLE_HEALTH_BACKFILL_QUEUE,
        payload,
        integrationBackfillSourceOptions(
          `google-health-backfill|${userId}`,
          startAfterSeconds,
        ),
      );
      if (jobId) {
        enqueued += 1;
      } else {
        skipped += 1;
      }
    }
    return { enqueued, skipped, error: null };
  } catch (err) {
    return {
      enqueued: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
