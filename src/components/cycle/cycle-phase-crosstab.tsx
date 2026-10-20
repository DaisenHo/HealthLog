"use client";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { Formatters } from "@/lib/format-locale";
import { useUnitDisplay } from "@/hooks/use-unit-display";
import {
  crosstabReading,
  MetricCrosstab,
  withUnit,
  type CrosstabMeasure,
} from "@/components/insights/metric-crosstab";

/**
 * v1.15 — CYCLE_PHASE × vital crosstab card.
 *
 * Mirrors the mood-factor × vital crosstab (`mood-factor-metric-crosstab.tsx`):
 * for each outcome metric, the vital's mean on LUTEAL-phase days vs
 * FOLLICULAR-phase days, the signed delta, n per group, q, and a confidence
 * chip. The math is pre-computed in `src/lib/cycle/phase-crosstab.ts`
 * (`computePhaseMetricCrosstab`) — the same Welch t-test + day floors +
 * Benjamini-Hochberg FDR the rest of the relations surface uses; only
 * FDR-surviving rows reach here. Observational only — the page-level
 * "associations, not causes" footer carries the caveat once. This surface is
 * gender-gated by its `/api/cycle/insights` route; phase never renders on the
 * general correlations surface.
 */

export type CyclePhaseCrosstabDisplay =
  "hours" | "steps" | "bpm" | "ms" | "kg" | "celsius" | "glucose" | "mood";

export type CyclePhaseCrosstabConfidence = "low" | "medium" | "high";

export interface CyclePhaseCrosstabRow {
  metricKey: string;
  display: CyclePhaseCrosstabDisplay;
  lutealDays: number;
  follicularDays: number;
  lutealAvg: number;
  follicularAvg: number;
  delta: number;
  pValue: number;
  qValue: number;
  confidence: CyclePhaseCrosstabConfidence;
}

const METRIC_LABEL_KEY: Record<string, string> = {
  restingHeartRate: "cycle.insights.crosstab.metricRestingHeartRate",
  heartRateVariability: "cycle.insights.crosstab.metricHrv",
  sleepDuration: "cycle.insights.crosstab.metricSleepDuration",
  steps: "cycle.insights.crosstab.metricSteps",
  weight: "cycle.insights.crosstab.metricWeight",
  basalBodyTemp: "cycle.insights.crosstab.metricBasalBodyTemp",
  wristTemperature: "cycle.insights.crosstab.metricWristTemperature",
  skinTemperature: "cycle.insights.crosstab.metricSkinTemperature",
  bloodGlucose: "cycle.insights.crosstab.metricBloodGlucose",
  mood: "cycle.insights.crosstab.metricMood",
};

/**
 * The measurement each row reads (`src/lib/cycle/phase-crosstab.ts`), which
 * is what its unit and its preference conversion come from. Mood has none.
 */
const METRIC_TYPE: Record<string, string | null> = {
  restingHeartRate: "RESTING_HEART_RATE",
  heartRateVariability: "HEART_RATE_VARIABILITY",
  sleepDuration: "SLEEP_DURATION",
  steps: "ACTIVITY_STEPS",
  weight: "WEIGHT",
  basalBodyTemp: "BODY_TEMPERATURE",
  wristTemperature: "WRIST_TEMPERATURE",
  skinTemperature: "SKIN_TEMPERATURE",
  bloodGlucose: "BLOOD_GLUCOSE",
  mood: null,
};

function measureOf(row: CyclePhaseCrosstabRow): CrosstabMeasure {
  return { type: METRIC_TYPE[row.metricKey] ?? null, display: row.display };
}

/** Whole numbers for steps; one decimal otherwise. */
function fmt(
  value: number,
  display: CyclePhaseCrosstabDisplay,
  nf: Formatters,
): string {
  return display === "steps" ? nf.integer(value) : nf.number(value, 1);
}

const HEADLINE_KEY: Record<string, string> = {
  restingHeartRate: "cycle.insights.headline.restingHeartRate",
  heartRateVariability: "cycle.insights.headline.heartRateVariability",
};

/**
 * The single headline finding rendered prominently above the grid. Resting
 * heart rate / HRV get bespoke phrasing; every other metric uses the generic
 * line. Returns null when nothing cleared the FDR gate — an honest empty state.
 */
export function CyclePhaseHeadline({
  headline,
}: {
  headline: CyclePhaseCrosstabRow | null;
}) {
  const { t } = useTranslations();
  const nf = useFormatters();
  const unitDisplay = useUnitDisplay();
  if (!headline) {
    return (
      <p
        data-slot="cycle-phase-headline-empty"
        className="text-muted-foreground text-sm"
      >
        {t("cycle.insights.headline.empty")}
      </p>
    );
  }
  const metricLabel = t(
    METRIC_LABEL_KEY[headline.metricKey] ?? headline.metricKey,
  );
  const { unit, delta: deltaConv } = crosstabReading(
    measureOf(headline),
    unitDisplay,
    t,
  );
  const up = headline.delta >= 0;
  const dir = t(
    up
      ? "cycle.insights.headline.dirHigher"
      : "cycle.insights.headline.dirLower",
  );
  const params = {
    metric: metricLabel,
    // A phase delta → factor-only conversion (no affine offset).
    delta: withUnit(
      fmt(Math.abs(deltaConv(headline.delta)), headline.display, nf),
      unit,
    ),
    dir,
  };
  const key =
    HEADLINE_KEY[headline.metricKey] ?? "cycle.insights.headline.generic";
  return (
    <p
      data-slot="cycle-phase-headline"
      data-metric={headline.metricKey}
      className="text-foreground text-sm font-medium"
    >
      {t(key, params)}
    </p>
  );
}

export function CyclePhaseCrosstab({
  rows,
}: {
  rows: CyclePhaseCrosstabRow[];
}) {
  const { t } = useTranslations();
  const nf = useFormatters();
  const unitDisplay = useUnitDisplay();
  return (
    <MetricCrosstab
      slot="cycle-phase-crosstab"
      rowSlot="cycle-phase-crosstab-row"
      description={t("cycle.insights.crosstab.description")}
      rows={rows.map((row) => {
        const metricLabel = t(METRIC_LABEL_KEY[row.metricKey] ?? row.metricKey);
        const measure = measureOf(row);
        const {
          unit,
          abs: absConv,
          delta: deltaConv,
        } = crosstabReading(measure, unitDisplay, t);
        // `delta` = lutealAvg − follicularAvg: positive = the vital runs
        // higher in the luteal phase.
        return {
          key: row.metricKey,
          metricKey: row.metricKey,
          pairLabel: t("cycle.insights.crosstab.pairLabel", {
            metric: metricLabel,
          }),
          up: row.delta >= 0,
          deltaValue: fmt(deltaConv(row.delta), row.display, nf),
          measure,
          confidence: row.confidence,
          detail: t("cycle.insights.crosstab.detail", {
            metric: metricLabel,
            lutealAvg: withUnit(
              fmt(absConv(row.lutealAvg), row.display, nf),
              unit,
            ),
            follicularAvg: withUnit(
              fmt(absConv(row.follicularAvg), row.display, nf),
              unit,
            ),
            lutealDays: row.lutealDays,
            follicularDays: row.follicularDays,
          }),
        };
      })}
    />
  );
}
