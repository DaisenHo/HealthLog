/**
 * `GET/POST /api/admin/maintenance/pulse-day-mean` — the pulse day-mean
 * method (#1107 follow-up).
 *
 * GET answers the active method, when it was applied and the last dry run
 * (status and result: per-account labels only, never an id). POST
 * `{ action: "dry_run" | "apply" }` answers 202 `{ enqueued }`: a dry run
 * computes both methods for every account and day and writes nothing but its
 * result; `apply` needs a successful dry run from the last seven days (409
 * `maintenance.pulseDayMean.dryRunRequired`), switches the method and
 * rebuilds the pulse rollups. 409 `maintenance.pulseDayMean.busy` while a run
 * is active. Admin only, cookie session only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAdmin } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { pulseDayMeanActionSchema } from "@/lib/validations/pulse-day-mean";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requireAdmin();
  return notImplemented("admin.pulse_day_mean.get");
});

export const POST = apiHandler(async (request: NextRequest) => {
  await requireAdmin();

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;
  const parsed = pulseDayMeanActionSchema.safeParse(body);
  if (!parsed.success) return returnAllZodIssues(parsed.error, 422);

  return notImplemented("admin.pulse_day_mean.post");
});
