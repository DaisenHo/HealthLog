import { apiHandler, requireAdmin } from "@/lib/api-handler";
import { apiSuccess } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { prisma } from "@/lib/db";

/**
 * v1.4.16 — admin AI quality preview.
 *
 * Returns the latest aggregator-written summary from
 * `AppSettings.adminAiInsightsFeedbackSummary`. The pg-boss
 * `feedback-aggregator` queue writes this row daily at 04:00
 * Europe/Berlin. requireAdmin() gates the endpoint — cross-user
 * helpful-rate slices are admin-only telemetry per research §3.
 *
 * The response payload is intentionally the raw summary blob (no
 * envelope reshaping) so the v1.4.17 ratchet that consumes it for
 * prompt-tuning can read the same shape the worker writes.
 *
 * Empty state (`null` summary) means the aggregator hasn't run yet
 * OR there's been no feedback in the rolling window. The admin UI
 * surfaces a "no data yet" empty state rather than a fake zero row
 * so the operator can tell "no feedback" apart from "all-zeros".
 */
export const GET = apiHandler(async () => {
  await requireAdmin();

  const settings = await prisma.appSettings.findUnique({
    where: { id: "singleton" },
    select: { adminAiInsightsFeedbackSummary: true },
  });

  const summary = settings?.adminAiInsightsFeedbackSummary ?? null;

  annotate({
    action: { name: "admin.ai_quality.read" },
    meta: {
      has_summary: summary !== null,
    },
  });

  return apiSuccess({ summary });
});
