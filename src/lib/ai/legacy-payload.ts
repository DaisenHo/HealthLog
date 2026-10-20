/**
 * v1.4.16 — legacy-payload detection.
 *
 * Cached insight blobs persisted before B5c shipped don't carry the
 * `rationale` field. The /api/insights/generate route surfaces a
 * `legacyPayload: true` flag on cache-hit so the UI can render a
 * "Insights updated — regenerate for new explainability features"
 * CTA. User-initiated regeneration stays the trigger; we do NOT
 * auto-regenerate on cache-hit (that would burn rate-limit tokens
 * silently and surprise users who explicitly toggled cache-only).
 *
 * Detection is lenient on purpose: the cached payload may carry
 * either the canonical `AIInsightResponse` shape (structured recs)
 * or the legacy `InsightResult` shape (string-only recommendations).
 * Both predate B5c rationale; both flag.
 */

/**
 * Returns true when the payload predates the v1.4.16 strict insight
 * shape and the UI must surface the regenerate CTA instead of trying
 * to render the rich card.
 *
 * Detection branches:
 * - Non-object / null / undefined input → false (nothing to migrate).
 * - **v1.4.14 pre-strict shape** (`{changed, stable, drivers, ...}` —
 *   no `summary`, no `recommendations[]`, no `findings[]`): true. This
 *   is the production crash the maintainer hit on 2026-05-10 — the route's
 *   `safeParse` failed against `insightResultSchema`, fell through to
 *   the raw blob, and the rich card called `.replace()` on
 *   `undefined`. Detect by absence of *both* `summary` (string) and
 *   `recommendations` (array).
 * - **v1.4.15 mid-shape** (recommendations[] present, all strings):
 *   true (plain-string recs predate B5c rationale).
 * - **v1.4.16 pre-B5c shape** (recommendations[] present, structured,
 *   missing `rationale`): true.
 * - Otherwise → false.
 */
export function isLegacyInsightPayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) return false;
  if (typeof payload !== "object") return false;
  const obj = payload as { summary?: unknown; recommendations?: unknown };

  const recs = obj.recommendations;
  const hasSummary = typeof obj.summary === "string" && obj.summary.length > 0;
  const hasRecsArray = Array.isArray(recs);

  // v1.4.14 / pre-strict shape: neither the modern `summary` string nor
  // a `recommendations` array is present. The blob still parses as
  // JSON but the rich card surface has nothing to render.
  if (!hasSummary && !hasRecsArray) return true;

  // Modern-shape but recs missing entirely — refusal payload, not
  // legacy. Don't gate the regenerate CTA on this.
  if (!hasRecsArray) return false;
  if (!Array.isArray(recs)) return false; // narrowing for TS
  if (recs.length === 0) return false;

  for (const rec of recs) {
    // Legacy InsightResult shape: string-only recommendations[]
    if (typeof rec === "string") return true;
    // Structured rec: rationale must be a populated object.
    if (rec === null || typeof rec !== "object") return true;
    const rationale = (rec as { rationale?: unknown }).rationale;
    if (
      rationale === undefined ||
      rationale === null ||
      typeof rationale !== "object"
    ) {
      return true;
    }
  }
  return false;
}
