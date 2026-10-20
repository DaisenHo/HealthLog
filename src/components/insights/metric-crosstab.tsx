"use client";

import type { LucideIcon } from "lucide-react";

import { CONFIDENCE_TONE, ScorePill } from "@/components/ui/score-pill";
import { useTranslations } from "@/lib/i18n/context";
import {
  PatternDismissButton,
  PatternDismissedNotice,
  usePatternDismissalOverrides,
} from "@/components/insights/pattern-dismiss-action";

/**
 * The "this vital on these days vs those days" board: one row per pair, the
 * signed difference, a confidence chip, one detail line with both means and
 * the day count. Three surfaces carry it — mood tag × metric, rated mood
 * factor × metric, cycle phase × vital — and they were three copies of the
 * same markup that had begun to differ (the cycle copy printed its numbers
 * with a full stop in every language).
 *
 * The caller owns the meaning: it resolves the labels, converts the units and
 * formats the numbers (`deltaValue` already in the reader's notation, signed
 * when negative). This component owns the shape: the row, the neutral delta
 * (a higher value is good on one row and bad on the next, so the number is
 * never coloured; the sign and `data-direction` carry the direction), the
 * confidence chip, and the optional per-row dismissal.
 */

export type MetricCrosstabConfidence = "low" | "medium" | "high";

export interface MetricCrosstabRow {
  /** React key. */
  key: string;
  /** `data-metric` on the row. */
  metricKey: string;
  pairLabel: string;
  icon?: LucideIcon | null;
  /** True when the difference is zero or positive. */
  up: boolean;
  /** The difference in the reader's notation, with its minus sign. */
  deltaValue: string;
  unit: string;
  confidence: MetricCrosstabConfidence;
  detail: string;
  /** A dismissible pattern; omitted on boards that cannot be dismissed. */
  patternId?: string;
  canonicalKey?: string;
  dismissed?: boolean;
}

const CONFIDENCE_KEY: Record<MetricCrosstabConfidence, string> = {
  low: "insights.mood.influence.confidenceLow",
  medium: "insights.mood.influence.confidenceMedium",
  high: "insights.mood.influence.confidenceHigh",
};

export function MetricCrosstab({
  slot,
  rowSlot,
  description,
  rows,
}: {
  /** `data-slot` of the board. */
  slot: string;
  /** `data-slot` of each row. */
  rowSlot: string;
  description: string;
  rows: readonly MetricCrosstabRow[];
}) {
  const { t } = useTranslations();
  const dismissal = usePatternDismissalOverrides();
  if (rows.length === 0) return null;

  return (
    <div data-slot={slot}>
      <p className="text-muted-foreground mb-2 text-sm">{description}</p>
      <ul className="divide-border divide-y">
        {rows.map((row) => {
          const patternId = row.patternId;
          if (
            patternId &&
            dismissal.isDismissed(patternId, row.dismissed === true)
          ) {
            return (
              <li key={row.canonicalKey ?? patternId} className="py-2">
                <PatternDismissedNotice
                  compact
                  patternId={patternId}
                  onRestored={() => dismissal.setDismissed(patternId, false)}
                  onSettled={() => dismissal.clearDismissed(patternId, false)}
                />
              </li>
            );
          }
          const Icon = row.icon;
          return (
            <li
              key={row.key}
              className="flex flex-col gap-1.5 py-2"
              data-slot={rowSlot}
              data-metric={row.metricKey}
              data-direction={row.up ? "up" : "down"}
              data-confidence={row.confidence}
            >
              <div className="flex items-center gap-2 text-sm">
                {Icon ? (
                  <Icon
                    className="text-muted-foreground size-4 shrink-0"
                    aria-hidden="true"
                  />
                ) : null}
                <span
                  className="text-foreground min-w-0 flex-1 truncate"
                  title={row.pairLabel}
                >
                  {row.pairLabel}
                </span>
                <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
                  {`${row.up ? "+" : ""}${row.deltaValue} ${row.unit}`.trim()}
                </span>
                <ScorePill tone={CONFIDENCE_TONE[row.confidence]}>
                  {t(CONFIDENCE_KEY[row.confidence])}
                </ScorePill>
                {patternId ? (
                  <PatternDismissButton
                    patternId={patternId}
                    onDismissed={() => dismissal.setDismissed(patternId, true)}
                    onSettled={() => dismissal.clearDismissed(patternId, true)}
                    className="shrink-0"
                  />
                ) : null}
              </div>
              <p className="text-muted-foreground text-xs">{row.detail}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
