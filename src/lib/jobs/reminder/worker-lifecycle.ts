/**
 * Reminder-worker boot lifecycle helpers.
 *
 * These run once per worker process around the queue/schedule/handler wiring
 * in `reminder-worker.ts`: a graceful-shutdown signal binding plus two
 * fire-and-forget boot maintenance passes. None of them touch the pg-boss
 * queue declarations, the `allQueues` array, the `schedules` table, or the
 * `boss.work` bindings — those stay co-located in `reminder-worker.ts` so the
 * source-text registration guards (the v1.4.37 dead-queue catch) keep working.
 */
import type { PgBoss } from "pg-boss";

import { reconcileOrphanImportJobs } from "@/lib/jobs/apple-health-import-worker";
import { probeIntegrationStatusNullBuckets } from "@/lib/jobs/integration-status-null-probe";
import { withBackgroundEvent } from "@/lib/logging/background";

import { getWorkerPrisma, workerLog } from "./shared";

/** How long running jobs get to finish on a stop signal. */
export const SHUTDOWN_JOB_TIMEOUT_MS = 30_000;

/**
 * Graceful shutdown: drain in-flight jobs on SIGTERM/SIGINT (sent by Docker
 * Compose `docker stop`, Kubernetes pod termination, Coolify redeploys).
 *
 * Next's own signal handler closes the HTTP server (finishing the requests
 * in flight) and then calls `process.exit`. That exit used to win the race
 * against `boss.stop`, so a running job was cut off mid-way and stayed
 * `active` until its expiry, which kept an exclusive queue blocked. The
 * handler therefore holds `process.exit` until the boss has stopped: both
 * drains run side by side, the process leaves when the slower one is done,
 * and never later than {@link SHUTDOWN_JOB_TIMEOUT_MS} plus a margin, so a
 * stuck handler cannot block a deploy. Compose gives the container 45 s
 * (`stop_grace_period`) for this.
 *
 * The listeners register once; re-entering the worker boot (hot reload in
 * dev) is a no-op for them because the first signal stops everything.
 */
export function registerShutdownHandlers(
  boss: Pick<PgBoss, "stop">,
  proc: Pick<NodeJS.Process, "once" | "exit"> = process,
): void {
  let drained: Promise<void> | null = null;
  const onSignal = (signal: "SIGTERM" | "SIGINT") => {
    if (drained) return;
    workerLog("error", `received ${signal}, draining boss`);
    // graceful=true waits for active handlers to finish, then closes the
    // pg connection pool. The timeout caps it.
    drained = boss
      .stop({ graceful: true, timeout: SHUTDOWN_JOB_TIMEOUT_MS })
      .catch((err: unknown) => {
        workerLog("error", "boss.stop failed during shutdown", err);
      });
    const exit = proc.exit.bind(proc);
    const deadline = new Promise<void>((resolve) =>
      setTimeout(resolve, SHUTDOWN_JOB_TIMEOUT_MS + 5_000).unref(),
    );
    let exiting = false;
    proc.exit = ((code?: number | string | null) => {
      if (exiting) return undefined as never;
      exiting = true;
      void Promise.race([drained, deadline]).finally(() => exit(code));
      return undefined as never;
    }) as typeof proc.exit;
  };
  proc.once("SIGTERM", () => onSignal("SIGTERM"));
  proc.once("SIGINT", () => onSignal("SIGINT"));
}

/**
 * v1.4.34 — reconcile any `ImportJob` rows that were mid-parse when the worker
 * last shut down. Flips orphaned rows to `failed` so the operator can
 * re-upload without leaving the polling endpoint stuck on `parsing` /
 * `upserting`. Never throws.
 */
export async function reconcileImportJobsAtBoot(): Promise<void> {
  try {
    await reconcileOrphanImportJobs();
  } catch (err) {
    workerLog("error", "Failed to reconcile orphan ImportJob rows", err);
  }
}

/**
 * v1.4.48 — boot probe for legacy `integration_statuses` rows that still
 * carry `consecutive_failures_by_kind = NULL`. After v1.4.47 dropped the
 * single-column fallback, such rows alert two strikes later than they did
 * pre-upgrade. The probe is a single count query + Wide-Event warning if any
 * survive; fire-and-forget so a probe failure never blocks worker boot.
 */
export async function probeIntegrationStatusAtBoot(): Promise<void> {
  try {
    await withBackgroundEvent(
      "worker.boot.integration_status_null_probe",
      async () => {
        await probeIntegrationStatusNullBuckets(getWorkerPrisma());
      },
    );
  } catch (err) {
    workerLog("error", "integration-status-null-probe failed", err);
  }
}
