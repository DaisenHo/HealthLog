import { z } from "zod/v4";

/**
 * v1.4.16 — request body for `POST /api/insights/feedback`.
 *
 * Mirrors the `RecommendationFeedback` Prisma model fields the client
 * is allowed to specify. `providerType` and `promptVersion` are NOT
 * part of the request shape — the server fills them from the user's
 * most recent cached payload + the current PROMPT_VERSION constant
 * so the client can't tamper with the attribution that the daily
 * aggregator slices on for the admin AI quality dashboard.
 *
 * Severity + dataWindow are constrained to the same vocabulary as the
 * AI schema (`aiRecommendationSchema` / `aiRecommendationRationaleSchema`)
 * so a bogus rating attempt with `severity = "wat"` is rejected at the
 * edge instead of poisoning the aggregator.
 */
export const recommendationFeedbackSeverity = z.enum([
  "info",
  "suggestion",
  "important",
  "urgent",
]);

export const recommendationFeedbackTimeRange = z.enum([
  "last7days",
  "last30days",
  "last90days",
  "allTime",
]);

export const recommendationFeedbackRequestSchema = z.object({
  /**
   * Stable per-payload rec id. Dedup happens on
   * (userId, recommendationId, recommendationText).
   */
  recommendationId: z.string().min(1).max(200),
  /**
   * Snapshot of the rec text at submission time. Dedup partner so a
   * regeneration that rewrites the same id with new text counts as a
   * different row — that's intentional, the aggregator wants per-text
   * signal not per-id signal.
   */
  recommendationText: z.string().min(1).max(2000),
  recommendationSeverity: recommendationFeedbackSeverity,
  metricSourceType: z.string().min(1).max(80),
  metricSourceTimeRange: recommendationFeedbackTimeRange,
  helpful: z.boolean(),
});

export type RecommendationFeedbackRequest = z.infer<
  typeof recommendationFeedbackRequestSchema
>;
