import { prisma } from "@/lib/db";
import { getWorkerStatus } from "@/lib/jobs/worker-status";
import { getGlobalBoss } from "@/lib/jobs/boss-instance";
import { shouldRunWeb, shouldRunWorker } from "@/lib/process-type";
import { getSession } from "@/lib/auth/session";
import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/api-handler";
import { annotate } from "@/lib/logging/context";
import {
  getKeyMismatchWarning,
  isKeyMismatch,
  KEY_MISMATCH_HEALTH_REASON,
} from "@/lib/boot/key-mismatch-state";
import { startupPhase } from "@/lib/boot/startup-state";

/**
 * How long the probe waits for `SELECT 1`. During a boot storm the pool can
 * be saturated by the worker's start-up work; a probe that waits its turn
 * held a monitor for seconds. Past this the database counts as not answering
 * and the probe says `degraded` at once.
 */
const DB_PROBE_TIMEOUT_MS = 2_000;

/** Reported while the background role is still coming up. */
const STARTING_HEALTH_REASON = "starting";

async function probeDatabase(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      prisma.$queryRaw`SELECT 1`.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), DB_PROBE_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  annotate({ action: { name: "health.check" } });

  const dbOk = await probeDatabase();

  const worker = getWorkerStatus();
  const producerReady = getGlobalBoss() !== null;
  // A process whose encryption key cannot open the database refuses every
  // other route; the probe says so in a word every caller may see, because
  // it is the one place a catalog install's status page reads.
  const keyMismatch = isKeyMismatch();
  // Otherwise, while the background role is still starting, the 503 below
  // says so: a transient state, not a fault, and not a hang.
  const roleDown =
    (shouldRunWeb() && !producerReady) ||
    (shouldRunWorker() && !worker.running);
  const reason = keyMismatch
    ? KEY_MISMATCH_HEALTH_REASON
    : dbOk && roleDown && startupPhase() === "starting"
      ? STARTING_HEALTH_REASON
      : undefined;
  // Under ENCRYPTION_KEY_CHECK=warn the same finding does not refuse; it is
  // named as a warning and leaves the status alone.
  const warning =
    !keyMismatch && getKeyMismatchWarning()
      ? KEY_MISMATCH_HEALTH_REASON
      : undefined;
  const status = !keyMismatch && dbOk && !roleDown ? "ok" : "degraded";
  const statusCode = status === "ok" ? 200 : 503;

  const cacheHeaders = {
    "Cache-Control": "no-store, no-cache, must-revalidate",
  };

  // Only expose detailed info to authenticated admins
  const session = await getSession().catch(() => null);
  if (session?.user?.role === "ADMIN") {
    return NextResponse.json(
      {
        status,
        ...(reason ? { reason } : {}),
        ...(warning ? { warning } : {}),
        timestamp: new Date().toISOString(),
        database: dbOk ? "connected" : "disconnected",
        worker: worker.running ? "running" : "stopped",
        ...(worker.lastHeartbeat
          ? { workerLastHeartbeat: worker.lastHeartbeat }
          : {}),
      },
      { status: statusCode, headers: cacheHeaders },
    );
  }

  return NextResponse.json(
    { status, ...(reason ? { reason } : {}), ...(warning ? { warning } : {}) },
    { status: statusCode, headers: cacheHeaders },
  );
});
