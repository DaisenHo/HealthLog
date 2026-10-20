"use client";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { Formatters } from "@/lib/format-locale";
import { useUnitDisplay } from "@/hooks/use-unit-display";
import { moodTagIcon } from "@/components/mood/mood-tag-icons";
import {
  crosstabReading,
  MetricCrosstab,
  withUnit,
  type CrosstabMeasure,
} from "@/components/insights/metric-crosstab";
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

/** The measurement each row reads (`src/lib/insights/mood-crosstab.ts`). */
const METRIC_TYPE: Record<string, string> = {
  sleepDuration: "SLEEP_DURATION",
  steps: "ACTIVITY_STEPS",
  restingHeartRate: "RESTING_HEART_RATE",
  heartRateVariability: "HEART_RATE_VARIABILITY",
  weight: "WEIGHT",
  bloodPressureSystolic: "BLOOD_PRESSURE_SYS",
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
        // Weight follows the metric/imperial preference (values and unit
        // together); every other row keeps the server's value.
        const measure: CrosstabMeasure = {
          type: METRIC_TYPE[row.metricKey] ?? null,
          display: row.display,
        };
        const { unit, abs, delta } = crosstabReading(measure, unitDisplay, t);
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
          deltaValue: formatValue(delta(row.delta), row.display, nf),
          measure,
          confidence: row.confidence,
          detail: t(
            row.inverse
              ? "insights.mood.factorCrosstab.detailInverse"
              : "insights.mood.factorCrosstab.detail",
            {
              factor: factorLabel,
              metric: metricLabel,
              lowAvg: withUnit(
                formatValue(abs(row.lowAvg), row.display, nf),
                unit,
              ),
              highAvg: withUnit(
                formatValue(abs(row.highAvg), row.display, nf),
                unit,
              ),
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
