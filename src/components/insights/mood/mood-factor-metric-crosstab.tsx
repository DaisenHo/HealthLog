"use client";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { Formatters } from "@/lib/format-locale";
import { useUnitDisplay } from "@/hooks/use-unit-display";
import { moodTagIcon } from "@/components/mood/mood-tag-icons";
import { MetricCrosstab } from "@/components/insights/metric-crosstab";
import type { MoodInfluenceConfidence } from "./mood-tag-influence";

/**
 * v1.14.0 — RATED-factor × vital crosstab card.
 *
 * The cross-domain bridge: for each factor the user scores per entry (work /
 * sleep-quality / stress …), a vital's mean on the days the factor was rated
 * LOW (below its median) vs HIGH, the delta, and a confidence chip. The math
 * is pre-computed in `mood-aggregates.ts` (`computeFactorMetricCrosstab`) —
 * the same Welch t-test + day floors + Benjamini-Hochberg FDR the rest of the
 * relations surface uses; only FDR-surviving rows reach here. An inverse
 * factor (stress / conflict) already runs its split on the flipped series, so
 * "low" always means a worse day; the phrasing reads "your worse <factor>
 * days". Observational only: the page-level "associations, not causes" footer
 * carries the caveat once.
 */

export type MoodFactorCrosstabDisplay =
  "hours" | "score" | "steps" | "bpm" | "ms" | "kg" | "mmHg";
export type MoodFactorCrosstabMode = "sameDay" | "nextDay";

export interface MoodFactorMetricCrosstabRow {
  factor: string;
  labelKey: string;
  categoryKey: string;
  icon: string | null;
  inverse: boolean;
  metricKey: string;
  display: MoodFactorCrosstabDisplay;
  mode: MoodFactorCrosstabMode;
  lowDays: number;
  highDays: number;
  lowAvg: number;
  highAvg: number;
  delta: number;
  pValue: number;
  qValue: number;
  confidence: MoodInfluenceConfidence;
  patternId?: string;
  canonicalKey?: string;
  dismissed?: boolean;
}

const METRIC_LABEL_KEY: Record<string, string> = {
  sleepDuration: "insights.mood.factorCrosstab.metricSleepDuration",
  steps: "insights.mood.factorCrosstab.metricSteps",
  restingHeartRate: "insights.mood.factorCrosstab.metricRestingHeartRate",
  heartRateVariability: "insights.mood.factorCrosstab.metricHrv",
  weight: "insights.mood.factorCrosstab.metricWeight",
  bloodPressureSystolic: "insights.mood.factorCrosstab.metricBloodPressureSys",
};

const UNIT_KEY: Record<MoodFactorCrosstabDisplay, string> = {
  hours: "insights.mood.factorCrosstab.unitHours",
  score: "insights.mood.factorCrosstab.unitScore",
  steps: "insights.mood.factorCrosstab.unitSteps",
  bpm: "insights.mood.factorCrosstab.unitBpm",
  ms: "insights.mood.factorCrosstab.unitMs",
  kg: "insights.mood.factorCrosstab.unitKg",
  mmHg: "insights.mood.factorCrosstab.unitMmHg",
};

/** Whole numbers for steps; one decimal otherwise. */
function formatValue(
  value: number,
  display: MoodFactorCrosstabDisplay,
  nf: Formatters,
): string {
  return display === "steps" ? nf.integer(value) : nf.number(value, 1);
}

export function MoodFactorMetricCrosstab({
  rows,
}: {
  rows: MoodFactorMetricCrosstabRow[];
}) {
  const { t } = useTranslations();
  const nf = useFormatters();
  const unitDisplay = useUnitDisplay();
  return (
    <MetricCrosstab
      slot="mood-factor-metric-crosstab"
      rowSlot="mood-factor-crosstab-row"
      description={t("insights.mood.factorCrosstab.description")}
      rows={rows.map((row) => {
        const factorLabel = t(row.labelKey);
        const metricLabel = t(METRIC_LABEL_KEY[row.metricKey] ?? row.metricKey);
        // The weight ("kg") row follows the metric/imperial preference: the
        // unit symbol and the values (averages and delta, all in kg,
        // offset-free) convert together. Every other display is unitless to
        // the preference and keeps its i18n label and raw value.
        const isWeightRow = row.display === "kg";
        const unit = isWeightRow
          ? unitDisplay.unitFor("WEIGHT")
          : t(UNIT_KEY[row.display]);
        const conv = (v: number) =>
          isWeightRow ? unitDisplay.toDisplay("WEIGHT", v) : v;
        // `delta` = lowAvg − highAvg: positive = the vital runs higher on the
        // low-factor (worse) days.
        return {
          key: `${row.metricKey}:${row.factor}`,
          metricKey: row.metricKey,
          pairLabel: t("insights.mood.factorCrosstab.pairLabel", {
            factor: factorLabel,
            metric: metricLabel,
          }),
          icon: moodTagIcon(row.icon),
          up: row.delta >= 0,
          deltaValue: formatValue(conv(row.delta), row.display, nf),
          unit,
          confidence: row.confidence,
          detail: t(
            row.inverse
              ? "insights.mood.factorCrosstab.detailInverse"
              : "insights.mood.factorCrosstab.detail",
            {
              factor: factorLabel,
              metric: metricLabel,
              lowAvg: formatValue(conv(row.lowAvg), row.display, nf),
              highAvg: formatValue(conv(row.highAvg), row.display, nf),
              unit,
              lowDays: row.lowDays,
            },
          ),
          patternId: row.patternId,
          canonicalKey: row.canonicalKey,
          dismissed: row.dismissed,
        };
      })}
    />
  );
}
