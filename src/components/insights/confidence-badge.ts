/**
 * v1.4.20 — shared confidence-band classnames.
 *
 * Both `<CorrelationCard>` and `<TrendAnnotation>` paint a discrete
 * "low / moderate / high" badge with byte-identical semantic utility
 * classes. Per-component i18n key maps stay local because the copy
 * differs (correlationRow.* vs trendAnnotation.*); only the classname
 * table is the load-bearing duplication.
 */
export type ConfidenceBand = "low" | "moderate" | "high";

export const CONFIDENCE_BADGE_CLASS: Record<ConfidenceBand, string> = {
  high: "border-success/40 bg-success/10 text-success",
  moderate: "border-warning/40 bg-warning/10 text-warning",
  // Neutral (non-status) tier. The former `*-dracula-comment/*` classes
  // had no generated utility (`--color-dracula-comment` was never in the
  // @theme block) and silently painted nothing; border/muted is the real
  // neutral vocabulary.
  low: "border-border bg-muted/50 text-muted-foreground",
};
