"use client";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { Formatters } from "@/lib/format-locale";
import { moodTagIcon } from "@/components/mood/mood-tag-icons";
import { useUnitDisplay } from "@/hooks/use-unit-display";
import {
  crosstabReading,
  MetricCrosstab,
  withUnit,
  type CrosstabMeasure,
} from "@/components/insights/metric-crosstab";
import type { MoodInfluenceConfidence } from "./mood-tag-influence";

/**
 * v1.12.0 — tag × health-metric crosstab card.
 *
 * Daylio's "Activities & Mood" board, extended from mood to a health
 * METRIC: for each structured mood tag, a metric's mean on tag-present vs
 * tag-absent days, the delta, and a confidence chip. The math is
 * pre-computed in `mood-aggregates.ts` (`computeTagMetricCrosstab`) — the
 * same Welch t-test + day floors + Benjamini-Hochberg FDR the rest of the
 * relations surface uses; only FDR-surviving rows reach here. Observational
 * only: the generic "associations, not causes" caveat lives once in the
 * page-level Insights footer, so this card no longer repeats it.
 *
 * The delta read-out is NEUTRAL, matching the rated-factor board. Once the
 * board carries next-day resting heart rate alongside sleep and active energy,
 * a positive delta is good on one row and bad on the next, so a green/red
 * sign would assert a health verdict the association does not support. The
 * sign prefix and `data-direction` carry the direction instead.
 */

export type MoodCrosstabDisplay = "hours" | "kcal" | "score" | "bpm" | "ms";
export type MoodCrosstabMode = "sameDay" | "nextDay";

export interface MoodTagMetricCrosstabRow {
  tag: string;
  labelKey: string;
  /**
   * v1.16.11 — decrypted custom-tag label, resolved server-side. A custom
   * tag's `labelKey` mirrors its raw `custom:<uuid>` key, so the label
   * takes precedence over `t(labelKey)`. Null for catalogue tags.
   */
  label?: string | null;
  categoryKey: string;
  icon: string | null;
  metricKey: string;
  display: MoodCrosstabDisplay;
  mode: MoodCrosstabMode;
  withDays: number;
  withoutDays: number;
  withAvg: number;
  withoutAvg: number;
  delta: number;
  pValue: number;
  qValue: number;
  confidence: MoodInfluenceConfidence;
  patternId?: string;
  canonicalKey?: string;
  dismissed?: boolean;
}

const METRIC_LABEL_KEY: Record<string, string> = {
  activeEnergy: "insights.mood.crosstab.metricActiveEnergy",
  sleepDuration: "insights.mood.crosstab.metricSleepDuration",
  nextDayRecovery: "insights.mood.crosstab.metricNextDayRecovery",
  nextDayRestingHeartRate: "insights.mood.crosstab.metricNextDayRestingHr",
  nextDayHeartRateVariability: "insights.mood.crosstab.metricNextDayHrv",
};

/** The measurement each row reads (`src/lib/insights/mood-crosstab.ts`). */
const METRIC_TYPE: Record<string, string> = {
  activeEnergy: "ACTIVE_ENERGY_BURNED",
  sleepDuration: "SLEEP_DURATION",
  nextDayRecovery: "RECOVERY_SCORE",
  nextDayRestingHeartRate: "RESTING_HEART_RATE",
  nextDayHeartRateVariability: "HEART_RATE_VARIABILITY",
};

/** One decimal for hours/score, whole numbers for kcal. */
function formatValue(
  value: number,
  display: MoodCrosstabDisplay,
  nf: Formatters,
): string {
  return display === "kcal" ? nf.integer(value) : nf.number(value, 1);
}

export function MoodTagMetricCrosstab({
  rows,
}: {
  rows: MoodTagMetricCrosstabRow[];
}) {
  const { t } = useTranslations();
  const nf = useFormatters();
  const units = useUnitDisplay();
  return (
    <MetricCrosstab
      slot="mood-tag-metric-crosstab"
      rowSlot="mood-crosstab-row"
      description={t("insights.mood.crosstab.description")}
      rows={rows.map((row) => {
        const tagLabel = row.label ?? t(row.labelKey);
        const metricLabel = t(METRIC_LABEL_KEY[row.metricKey] ?? row.metricKey);
        const measure: CrosstabMeasure = {
          type: METRIC_TYPE[row.metricKey] ?? null,
          display: row.display,
        };
        const { unit, abs, delta } = crosstabReading(measure, units, t);
        return {
          key: `${row.metricKey}:${row.tag}`,
          metricKey: row.metricKey,
          pairLabel: t("insights.mood.crosstab.pairLabel", {
            tag: tagLabel,
            metric: metricLabel,
          }),
          icon: moodTagIcon(row.icon),
          up: row.delta >= 0,
          deltaValue: formatValue(delta(row.delta), row.display, nf),
          measure,
          confidence: row.confidence,
          detail: t(
            row.mode === "nextDay"
              ? "insights.mood.crosstab.detailNextDay"
              : "insights.mood.crosstab.detailSameDay",
            {
              withAvg: withUnit(
                formatValue(abs(row.withAvg), row.display, nf),
                unit,
              ),
              withoutAvg: withUnit(
                formatValue(abs(row.withoutAvg), row.display, nf),
                unit,
              ),
              withDays: row.withDays,
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
