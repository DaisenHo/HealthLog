/**
 * `GET/POST /api/admin/maintenance/pulse-day-mean` — the pulse day-mean
 * method (#1107 follow-up).
 *
 * GET answers the active method, when it was applied and the last dry run
 * (status and result: per-account ordinal labels only, never an id). POST
 * `{ action: "dry_run" | "apply" }` answers 202 `{ enqueued }`: a dry run
 * computes both methods for every account and day and writes nothing but its
 * result; `apply` needs a successful dry run from the last seven days (409
 * `maintenance.pulseDayMean.dryRunRequired`), switches the method and
 * rebuilds the pulse rollups. 409 `maintenance.pulseDayMean.busy` while a run
 * is active. Admin only, cookie session only. The work itself runs in the
 * background worker (`src/lib/jobs/pulse-day-mean.ts`).
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAdmin } from "@/lib/api-handler";
import {
  apiError,
  apiSuccess,
  getClientIp,
  returnAllZodIssues,
  safeJson,
} from "@/lib/api-response";
import { auditLog } from "@/lib/auth/audit";
import { prisma } from "@/lib/db";
import { getGlobalBoss } from "@/lib/jobs/boss-instance";
import {
  hasFreshDryRun,
  isPulseDayMeanRunActive,
  PULSE_DAY_MEAN_QUEUE,
  PULSE_DAY_MEAN_SEND_OPTIONS,
  readPulseDayMeanStatus,
  writeDryRun,
  type PulseDayMeanPayload,
} from "@/lib/jobs/pulse-day-mean";
import { annotate } from "@/lib/logging/context";
import {
  setActivePulseDayMeanMethod,
  type PulseDayMeanMethod,
} from "@/lib/measurements/day-statistic";
import { pulseDayMeanActionSchema } from "@/lib/validations/pulse-day-mean";

export const dynamic = "force-dynamic";

/** The method the apply step switches to. */
const APPLIED_METHOD: PulseDayMeanMethod = "weighted_hour_mean_v2";

function busy() {
  return apiError("A pulse day-mean run is already queued or running", 409, {
    errorCode: "maintenance.pulseDayMean.busy",
  });
}

export const GET = apiHandler(async () => {
  await requireAdmin();
  const status = await readPulseDayMeanStatus();
  annotate({
    action: { name: "admin.pulse_day_mean.status" },
    meta: {
      method: status.method,
      dry_run_status: status.lastDryRun?.status ?? null,
    },
  });
  return apiSuccess(status);
});

export const POST = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAdmin();

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;
  const parsed = pulseDayMeanActionSchema.safeParse(body);
  if (!parsed.success) return returnAllZodIssues(parsed.error, 422);
  const action = parsed.data.action;
  annotate({
    action: { name: "admin.pulse_day_mean.requested" },
    meta: { pulse_day_mean_action: action },
  });

  const boss = getGlobalBoss();
  if (!boss) return apiError("Background worker is not available", 503);
  if (await isPulseDayMeanRunActive()) return busy();

  if (action === "dry_run") {
    const previous = (await readPulseDayMeanStatus()).lastDryRun;
    await writeDryRun({
      status: "queued",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: null,
    });
    const payload: PulseDayMeanPayload = { action: "dry_run" };
    const jobId = await boss.send(
      PULSE_DAY_MEAN_QUEUE,
      payload,
      PULSE_DAY_MEAN_SEND_OPTIONS,
    );
    if (jobId === null) {
      // Another run took the singleton between the check and the send; the
      // last dry run stays what it was.
      if (previous) await writeDryRun(previous);
      return busy();
    }
    annotate({ meta: { pulse_day_mean_enqueued: true } });
    return apiSuccess({ enqueued: true }, 202);
  }

  if (!hasFreshDryRun(await readPulseDayMeanStatus())) {
    return apiError(
      "Run a dry run first; apply needs one finished in the last seven days",
      409,
      { errorCode: "maintenance.pulseDayMean.dryRunRequired" },
    );
  }

  // The method first, then the rebuild: the rollups read the stored method
  // inside their own statements, so a rebuild that starts before the switch
  // would write the old statistic again.
  const appliedAt = new Date();
  await prisma.appSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      pulseDayMeanMethod: APPLIED_METHOD,
      pulseDayMeanAppliedAt: appliedAt,
    },
    update: {
      pulseDayMeanMethod: APPLIED_METHOD,
      pulseDayMeanAppliedAt: appliedAt,
    },
  });
  setActivePulseDayMeanMethod(APPLIED_METHOD);
  const payload: PulseDayMeanPayload = { action: "rebuild" };
  const jobId = await boss.send(
    PULSE_DAY_MEAN_QUEUE,
    payload,
    PULSE_DAY_MEAN_SEND_OPTIONS,
  );
  const enqueued = jobId !== null;

  await auditLog("admin.pulseDayMean.apply", {
    userId: user.id,
    ipAddress: getClientIp(request),
    details: { method: APPLIED_METHOD, rebuildEnqueued: enqueued },
  });
  annotate({
    meta: { pulse_day_mean_enqueued: enqueued, method: APPLIED_METHOD },
  });
  return apiSuccess({ enqueued }, 202);
});
