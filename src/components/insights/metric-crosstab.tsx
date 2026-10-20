"use client";

import type { LucideIcon } from "lucide-react";

import { CONFIDENCE_TONE, ScorePill } from "@/components/ui/score-pill";
import { useUnitDisplay, type UnitDisplay } from "@/hooks/use-unit-display";
import { useTranslations } from "@/lib/i18n/context";
import {
  applyDisplayTransform,
  applyDisplayTransformDelta,
  getReadingTransform,
  isUnitSensitiveType,
} from "@/lib/measurements/display-transform";
import { measurementUnitLabel } from "@/lib/measurements/unit-label";
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
 * The caller owns the meaning: it resolves the labels and formats the numbers
 * (`deltaValue` already in the reader's notation, signed when negative). The
 * unit is not the caller's: each row names the measurement it reads
 * (`measure`), and the unit comes from `measurementUnitLabel`, the one table
 * every other read-out uses, after the reader's unit preference
 * ({@link crosstabReading}). The boards used to carry a unit table each, and
 * the German cycle board printed "S/min" where every other screen says "bpm".
 * This component owns the shape: the row, the neutral delta (a higher value
 * is good on one row and bad on the next, so the number is never coloured;
 * the sign and `data-direction` carry the direction), the confidence chip,
 * and the optional per-row dismissal.
 */

/**
 * How the server sends a board's values: the scale, not the label. Most are
 * the measurement's canonical unit; sleep arrives in hours (stored minutes),
 * and a mood value is a rating with no measurement type.
 */
export type CrosstabDisplay =
  | "hours"
  | "kcal"
  | "score"
  | "bpm"
  | "ms"
  | "steps"
  | "kg"
  | "mmHg"
  | "celsius"
  | "glucose"
  | "mood";

/** The storage token each display is in, for `measurementUnitLabel`. */
const DISPLAY_TOKEN: Record<CrosstabDisplay, string> = {
  hours: "h",
  kcal: "kcal",
  score: "score",
  bpm: "bpm",
  ms: "ms",
  steps: "steps",
  kg: "kg",
  mmHg: "mmHg",
  celsius: "celsius",
  glucose: "mg/dL",
  mood: "rating",
};

/** What one row reads: the measurement type (null for mood) and its scale. */
export interface CrosstabMeasure {
  type: string | null;
  display: CrosstabDisplay;
}

/**
 * The unit a row reads in, and the conversions of its absolute values and
 * its differences, under the reader's preferences. A type whose number
 * follows a preference (weight, temperature, glucose) takes the transform; any
 * other keeps the server's value. Either way the label is
 * `measurementUnitLabel`'s.
 */
export function crosstabReading(
  measure: CrosstabMeasure,
  units: UnitDisplay,
  t: (key: string) => string,
): {
  unit: string;
  abs: (value: number) => number;
  delta: (value: number) => number;
} {
  const { type } = measure;
  if (type && isUnitSensitiveType(type)) {
    // The reading transform, not `units.transformFor`: glucose follows its
    // own unit preference, not metric/imperial.
    const transform = getReadingTransform(type, {
      system: units.preference,
      glucoseUnit: units.glucoseUnit,
    });
    return {
      unit: measurementUnitLabel(type, transform.displayUnit, t),
      abs: (value) => applyDisplayTransform(value, transform),
      // A difference takes the factor only, never an affine offset (°C→°F).
      delta: (value) => applyDisplayTransformDelta(value, transform),
    };
  }
  return {
    unit: measurementUnitLabel(type ?? "", DISPLAY_TOKEN[measure.display], t),
    abs: (value) => value,
    delta: (value) => value,
  };
}

/** A formatted value with its unit, or the value alone when it has none. */
export function withUnit(value: string, unit: string): string {
  return unit ? `${value} ${unit}` : value;
}

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
  /** What the row reads; the unit beside the difference comes from it. */
  measure: CrosstabMeasure;
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
  const units = useUnitDisplay();
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
          const { unit } = crosstabReading(row.measure, units, t);
          return (
            <li
              key={row.key}
              className="flex flex-col gap-1.5 py-2"
              data-slot={rowSlot}
              data-metric={row.metricKey}
              data-direction={row.up ? "up" : "down"}
              data-confidence={row.confidence}
            >
              <div className="flex items-start gap-2 text-sm">
                {Icon ? (
                  <Icon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                ) : null}
                {/* The pair wraps rather than cutting a tag name short. */}
                <span
                  className="text-foreground min-w-0 flex-1 break-words"
                  data-slot="metric-crosstab-pair"
                >
                  {row.pairLabel}
                </span>
                <span className="text-foreground shrink-0 text-sm font-semibold tabular-nums">
                  {withUnit(`${row.up ? "+" : ""}${row.deltaValue}`, unit)}
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
