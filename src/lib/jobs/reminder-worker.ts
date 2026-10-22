/**
 * pg-boss based reminder worker — boot composition.
 *
 * v1.18.1 — this file was a 2143-LOC monolith that declared every pg-boss
 * queue name, listed them in one `allQueues` array, scheduled every cron, and
 * bound every `boss.work` handler inline. It is now a thin registration table:
 * `startReminderWorker()` boots pg-boss, runs the boot one-shots, then calls
 * the domain registrars under `src/lib/jobs/reminder/`. Each registrar owns the
 * four facts the v1.4.37 dead-queue guards pin — the queue-name constant, its
 * `allQueues` membership, its `[QUEUE, CRON]` schedule tuple, and its
 * `createAndWork(boss, QUEUE, …, handler)` binding — so a queue can never be
 * declared without being provisioned, scheduled, and drained.
 *
 * Usage: Run as a standalone process or call startReminderWorker() from a
 * custom server setup. In dev, use: npx tsx src/lib/jobs/reminder-worker.ts
 */
import { markWorkerStarted, recordError } from "@/lib/jobs/worker-status";
import { createWorkerBoss, setGlobalBoss } from "@/lib/jobs/boss-instance";
import { reportJobsCutOffAtBoot } from "@/lib/jobs/job-observer";
import { beginBootStep, reportBootSteps } from "@/lib/boot/boot-steps";
import { assertSubsystemEnabled } from "@/lib/process-type";
import { DATABASE_URL, workerLog } from "./reminder/shared";
import type { PgBoss } from "pg-boss";

/**
 * Give the event loop a turn. Each registrar's module graph is evaluated in
 * one synchronous stretch when it is first imported; loading the five one
 * after another, with a turn in between, keeps the longest stall to the
 * largest graph instead of the sum of all five, so requests and the health
 * probe are answered in between.
 */
const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Import one registrar module as its own boot step. The registrars and the
 * handler graphs behind them are loaded here, after `boss.start()`, rather
 * than when this module is imported.
 */
async function loadRegistrar<T>(
  name: string,
  load: () => Promise<T>,
): Promise<T> {
  beginBootStep(`load_${name}`);
  await yieldToLoop();
  const mod = await load();
  await yieldToLoop();
  return mod;
}

export async function startReminderWorker() {
  // v1.4: refuse to boot if the operator marked this container as
  // web-only via HEALTHLOG_PROCESS_TYPE.
  assertSubsystemEnabled("worker");

  if (!DATABASE_URL) {
    workerLog("error", "CRITICAL: DATABASE_URL is not set, refusing to start");
    return;
  }

  const boss = createWorkerBoss(DATABASE_URL);

  boss.on("error", (error: unknown) => {
    workerLog("error", "boss emitted error", error);
    recordError();
  });

  // Read before any `boss.work` binding below can take a job: whatever is
  // still active now was started by a process that is gone.
  beginBootStep("boss_start");
  const bootedAt = new Date();
  await boss.start();
  await reportJobsCutOffAtBoot(bootedAt);
  setGlobalBoss(boss);
  markWorkerStarted();

  // Graceful shutdown: drain in-flight jobs on SIGTERM/SIGINT.
  const lifecycle = await loadRegistrar(
    "worker_lifecycle",
    () => import("./reminder/worker-lifecycle"),
  );
  lifecycle.registerShutdownHandlers(boss);

  // Register every domain's queues (createQueue + schedule + boss.work). Each
  // registrar returns the queue names it provisioned; the aggregate is the
  // boot-level mirror of the per-registrar `allQueues` arrays the dead-queue
  // guards pin. Order preserves the monolith's createQueue / schedule / work
  // sequence (integration → status → rollup → reminders → maintenance).
  const integration = await loadRegistrar(
    "integration_sync",
    () => import("./reminder/register-integration-sync"),
  );
  const registeredQueues = await registerInStep(
    "integration_sync",
    boss,
    integration.registerIntegrationSyncQueues,
  );
  const status = await loadRegistrar(
    "status",
    () => import("./reminder/register-status"),
  );
  registeredQueues.push(
    ...(await registerInStep("status", boss, status.registerStatusQueues)),
  );
  const rollup = await loadRegistrar(
    "rollup",
    () => import("./reminder/register-rollup"),
  );
  registeredQueues.push(
    ...(await registerInStep("rollup", boss, rollup.registerRollupQueues)),
  );
  const reminders = await loadRegistrar(
    "reminders",
    () => import("./reminder/register-reminders"),
  );
  registeredQueues.push(
    ...(await registerInStep(
      "reminders",
      boss,
      reminders.registerReminderQueues,
    )),
  );
  const maintenance = await loadRegistrar(
    "maintenance",
    () => import("./reminder/register-maintenance"),
  );
  registeredQueues.push(
    ...(await registerInStep(
      "maintenance",
      boss,
      maintenance.registerMaintenanceQueues,
    )),
  );
  workerLog(
    "info",
    `[reminder-worker] registered ${registeredQueues.length} queues across 5 domain registrars`,
  );

  // v1.4.34 — reconcile any `ImportJob` rows that were mid-parse when the
  // worker last shut down, flipping orphaned rows to `failed`.
  beginBootStep("boot_reconcile");
  await lifecycle.reconcileImportJobsAtBoot();

  // v1.4.48 — boot probe for legacy `integration_statuses` rows that still
  // carry `consecutive_failures_by_kind = NULL`.
  await lifecycle.probeIntegrationStatusAtBoot();

  // Fire-and-forget boot discovery for every self-converging backfill /
  // consolidation pass. Each is idempotent across reboots and never fails
  // worker boot on a miss (errors come back through the helper's result).
  beginBootStep("boot_discovery");
  await rollup.enqueueRollupBootDiscovery();
  await integration.enqueueIntegrationSyncBootDiscovery();
  await maintenance.enqueueMaintenanceBootDiscovery();

  await reportBootSteps({ boot_queue_count: registeredQueues.length });
  return boss;
}

/** Run one registrar as its own boot step. */
async function registerInStep(
  name: string,
  boss: PgBoss,
  register: (boss: PgBoss) => Promise<readonly string[]>,
): Promise<string[]> {
  beginBootStep(`register_${name}`);
  return [...(await register(boss))];
}

// Run standalone
if (
  process.argv[1]?.endsWith("reminder-worker.ts") ||
  process.argv[1]?.endsWith("reminder-worker.js")
) {
  startReminderWorker().catch((err) => {
    workerLog("error", "Failed to start reminder worker", err);
    process.exit(1);
  });
}
