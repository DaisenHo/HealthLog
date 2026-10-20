"use client";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { Formatters } from "@/lib/format-locale";
import { useUnitDisplay, type UnitDisplay } from "@/hooks/use-unit-display";
import {
  applyDisplayTransform,
  applyDisplayTransformDelta,
  getReadingTransform,
} from "@/lib/measurements/display-transform";
import { MetricCrosstab } from "@/components/insights/metric-crosstab";

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
 * Bundle labels for the displays no preference changes. Weight, the
 * temperatures and glucose take their symbol from the reader's transform
 * (`DISPLAY_TO_TYPE` below) and have no bundle label to fall back on.
 */
const UNIT_KEY: Partial<Record<CyclePhaseCrosstabDisplay, string>> = {
  hours: "cycle.insights.crosstab.unitHours",
  steps: "cycle.insights.crosstab.unitSteps",
  bpm: "cycle.insights.crosstab.unitBpm",
  ms: "cycle.insights.crosstab.unitMs",
  mood: "cycle.insights.crosstab.unitMood",
};

/** Whole numbers for steps; one decimal otherwise. */
function fmt(
  value: number,
  display: CyclePhaseCrosstabDisplay,
  nf: Formatters,
): string {
  return display === "steps" ? nf.integer(value) : nf.number(value, 1);
}

/**
 * v1.32.26 — the two displays whose values follow the metric/imperial
 * preference, mapped to the measurement type that carries the transform. Weight
 * is offset-free (kg→lb); temperature is affine (°C→°F), so an ABSOLUTE phase
 * average takes `toDisplay` while a phase DELTA takes `toDisplayDelta` (the
 * offset must never leak into a difference).
 */
const DISPLAY_TO_TYPE: Partial<Record<CyclePhaseCrosstabDisplay, string>> = {
  kg: "WEIGHT",
  celsius: "BODY_TEMPERATURE",
  glucose: "BLOOD_GLUCOSE",
};

/**
 * Unit symbol and conversions for one row, from the reader's preferences.
 * Glucose follows the glucose unit (it used to print the mg/dL label from
 * the bundle beside raw mg/dL values for every reader); weight and
 * temperature follow metric/imperial; every other display keeps its bundle
 * label and its raw value.
 */
function rowUnits(
  display: CyclePhaseCrosstabDisplay,
  unitDisplay: UnitDisplay,
  t: (key: string) => string,
): {
  unit: string;
  abs: (v: number) => number;
  delta: (v: number) => number;
} {
  const type = DISPLAY_TO_TYPE[display];
  if (!type) {
    // Defensive: an unmapped display must never pass undefined to `t`
    // (whose resolver does `key.split(".")`). Empty unit on a miss.
    const unitKey = UNIT_KEY[display];
    return {
      unit: unitKey ? t(unitKey) : "",
      abs: (v) => v,
      delta: (v) => v,
    };
  }
  const transform = getReadingTransform(type, {
    system: unitDisplay.preference,
    glucoseUnit: unitDisplay.glucoseUnit,
  });
  return {
    unit: transform.displayUnit,
    abs: (v) => applyDisplayTransform(v, transform),
    delta: (v) => applyDisplayTransformDelta(v, transform),
  };
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
  const { unit, delta: deltaConv } = rowUnits(headline.display, unitDisplay, t);
  const up = headline.delta >= 0;
  const dir = t(
    up
      ? "cycle.insights.headline.dirHigher"
      : "cycle.insights.headline.dirLower",
  );
  const params = {
    metric: metricLabel,
    // A phase delta → factor-only conversion (no affine offset).
    delta: fmt(Math.abs(deltaConv(headline.delta)), headline.display, nf),
    unit,
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
        const {
          unit,
          abs: absConv,
          delta: deltaConv,
        } = rowUnits(row.display, unitDisplay, t);
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
          unit,
          confidence: row.confidence,
          detail: t("cycle.insights.crosstab.detail", {
            metric: metricLabel,
            lutealAvg: fmt(absConv(row.lutealAvg), row.display, nf),
            follicularAvg: fmt(absConv(row.follicularAvg), row.display, nf),
            unit,
            lutealDays: row.lutealDays,
            follicularDays: row.follicularDays,
          }),
        };
      })}
    />
  );
}
