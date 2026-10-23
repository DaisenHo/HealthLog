"use client";

import type { ReactNode } from "react";
import {
  Activity,
  Bone,
  Droplet,
  Droplets,
  Dumbbell,
  Footprints,
  Gauge,
  GlassWater,
  Heart,
  HeartPulse,
  Moon,
  Percent,
  Smile,
  Target,
  Thermometer,
  TrendingUp,
  Wind,
} from "lucide-react";

import { TrendCard } from "@/components/charts/trend-card";
import {
  getRangeColorClass,
  getRangeHint,
  toHoursSummary,
} from "@/components/dashboard/range-display";
import { SleepSourceDiscrepancyMarker } from "@/components/insights/sleep-source-discrepancy-marker";
import { summaryToTrend7Delta } from "@/lib/analytics/trend-delta";
import { isWindowSufficient } from "@/lib/analytics/window-confidence";
import { convertGlucose, glucoseFractionDigits } from "@/lib/glucose";
import { MEASUREMENT_TYPE_LABEL_KEYS } from "@/lib/measurements/type-label-keys";

import type { DashboardTileContext } from "./tile-context";

/** One card in the tile strip, positioned by `order`. */
export interface StripEntry {
  id: string;
  order: number;
  node: ReactNode;
}

/**
 * A strip tile: which layout widget switches and orders it, the rule that
 * decides whether it has anything to show, and the card(s) it paints.
 *
 * The layout toggle is applied by `buildStripEntries` for every tile, so
 * `visible` holds only the tile's own rule (a data floor, a module gate).
 * A tile can paint more than one card (blood pressure paints two, glucose one
 * per meal-time context); each card's `orderOffset` keeps them together
 * behind the widget's position.
 */
interface StripTile {
  widget: string;
  visible: (ctx: DashboardTileContext) => boolean;
  cards: (
    ctx: DashboardTileContext,
  ) => Array<{ id: string; orderOffset?: number; node: ReactNode }>;
}

const countOf = (summary: { count?: number } | null | undefined) =>
  summary?.count ?? 0;

/**
 * The pulse tile shows ONE of two statistics, and its name says which. With
 * resting rows it is the resting heart rate (one figure a day, judged against
 * the resting band); without them it is the pulse, whose latest value is the
 * latest day's mean of its hours' means, and no resting band colours it (it
 * would mark workout heart rate as "outside target").
 */
function pulseSource(ctx: DashboardTileContext) {
  const rhr = ctx.summaries?.RESTING_HEART_RATE;
  const hasRestingHr = countOf(rhr) > 0;
  return {
    hasRestingHr,
    summary: hasRestingHr ? rhr : ctx.summaries?.PULSE,
    type: hasRestingHr ? "RESTING_HEART_RATE" : "PULSE",
  };
}

/**
 * A tile for a plain metric: the headline, its 7- and 30-day means, the trend
 * and the comparison delta, nothing else. `display` names the type whose
 * metric / imperial transform applies; without it the values pass through.
 */
function plainCard(
  ctx: DashboardTileContext,
  id: string,
  props: {
    type: string;
    label: string;
    unit: string;
    icon: React.ComponentType<{ className?: string }>;
    display?: boolean;
    fractionDigits?: number;
    staleType?: string | null;
  },
): ReactNode {
  const s = ctx.summaries?.[props.type];
  const value = (v: number | null | undefined) =>
    props.display ? ctx.td(props.type, v) : (v ?? null);
  const delta = (v: number | null | undefined) =>
    props.display ? ctx.tdd(props.type, v) : v;
  return (
    <TrendCard
      key={id}
      fractionDigits={props.fractionDigits}
      label={props.label}
      latest={value(s?.latest)}
      unit={props.unit}
      avg7={value(s?.avg7)}
      avg30={value(s?.avg30)}
      slope30={s?.slope30 ?? null}
      trend7Delta={delta(summaryToTrend7Delta(s)) as number | null}
      icon={props.icon}
      directionSentiment={ctx.directionOf(props.type)}
      compareBaseline={ctx.compareBaseline}
      compareDelta={delta(ctx.tileCompareDelta(s)) as number | null}
      staleDays={ctx.tileStaleDays(
        props.staleType === undefined ? props.type : props.staleType,
      )}
    />
  );
}

/**
 * Every strip tile, in the order the cards are collected. Cards are then
 * sorted by their layout order (a stable sort), so for two widgets that share
 * an order this list decides which comes first.
 */
export const STRIP_TILES: readonly StripTile[] = [
  {
    widget: "weight",
    visible: (ctx) => countOf(ctx.summaries?.WEIGHT) > 0,
    cards: (ctx) => {
      const w = ctx.summaries?.WEIGHT;
      const unit = ctx.unitDisplay.unitFor("WEIGHT");
      const hint = getRangeHint(
        unit,
        { range: ctx.weightHintRange },
        ctx.t,
        ctx.fmt.number,
      );
      return [
        {
          id: "weight",
          node: (
            <TrendCard
              key="weight"
              label={ctx.t("dashboard.weightShort")}
              latest={ctx.td("WEIGHT", w?.latest)}
              unit={unit}
              avg7={ctx.td("WEIGHT", w?.avg7)}
              avg30={ctx.td("WEIGHT", w?.avg30)}
              avg7ColorClass={getRangeColorClass(w?.avg7, {
                range: ctx.weightRange,
              })}
              avg30ColorClass={getRangeColorClass(w?.avg30, {
                range: ctx.weightRange,
              })}
              avg7Hint={hint}
              avg30Hint={hint}
              slope30={w?.slope30 ?? null}
              trend7Delta={ctx.tdd("WEIGHT", summaryToTrend7Delta(w))}
              icon={Activity}
              directionSentiment={ctx.weightTrend.direction}
              compareBaseline={ctx.compareBaseline}
              compareDelta={ctx.tdd("WEIGHT", ctx.tileCompareDelta(w))}
              staleDays={ctx.tileStaleDays("WEIGHT")}
            />
          ),
        },
      ];
    },
  },
  {
    // One signal, two tiles: systolic and diastolic side by side at the size
    // of every other tile. The diastolic card's offset keeps it right behind
    // the systolic one.
    widget: "bp",
    visible: (ctx) =>
      countOf(ctx.summaries?.BLOOD_PRESSURE_SYS) > 0 ||
      countOf(ctx.summaries?.BLOOD_PRESSURE_DIA) > 0,
    cards: (ctx) =>
      [
        {
          id: "bp-sys",
          type: "BLOOD_PRESSURE_SYS",
          label: ctx.t("dashboard.bloodPressureSysShort"),
          range: ctx.bpSysRange,
          orderOffset: 0,
        },
        {
          id: "bp-dia",
          type: "BLOOD_PRESSURE_DIA",
          label: ctx.t("dashboard.bloodPressureDiaShort"),
          range: ctx.bpDiaRange,
          orderOffset: 0.001,
        },
      ].map(({ id, type, label, range, orderOffset }) => {
        const s = ctx.summaries?.[type];
        return {
          id,
          orderOffset,
          node: (
            <TrendCard
              key={id}
              fractionDigits={0}
              label={label}
              latest={s?.latest ?? null}
              unit="mmHg"
              avg7={s?.avg7 ?? null}
              avg30={s?.avg30 ?? null}
              avg7ColorClass={getRangeColorClass(s?.avg7, { range })}
              avg30ColorClass={getRangeColorClass(s?.avg30, { range })}
              avg7Hint={getRangeHint("mmHg", { range }, ctx.t, ctx.fmt.number)}
              avg30Hint={getRangeHint("mmHg", { range }, ctx.t, ctx.fmt.number)}
              slope30={s?.slope30 ?? null}
              trend7Delta={summaryToTrend7Delta(s)}
              icon={Heart}
              directionSentiment={ctx.directionOf(type)}
              compareBaseline={ctx.compareBaseline}
              compareDelta={ctx.tileCompareDelta(s)}
              staleDays={ctx.tileStaleDays(type)}
            />
          ),
        };
      }),
  },
  {
    widget: "pulse",
    visible: (ctx) =>
      countOf(ctx.summaries?.PULSE) > 0 ||
      countOf(ctx.summaries?.RESTING_HEART_RATE) > 0,
    cards: (ctx) => {
      const { hasRestingHr, summary: s, type } = pulseSource(ctx);
      const range = hasRestingHr ? ctx.pulseDisplayRange : null;
      return [
        {
          id: "pulse",
          node: (
            <TrendCard
              key="pulse"
              fractionDigits={0}
              label={
                hasRestingHr
                  ? ctx.t(MEASUREMENT_TYPE_LABEL_KEYS.RESTING_HEART_RATE)
                  : ctx.t("dashboard.pulseShort")
              }
              latest={s?.latest ?? null}
              unit="bpm"
              avg7={s?.avg7 ?? null}
              avg30={s?.avg30 ?? null}
              avg7ColorClass={getRangeColorClass(s?.avg7, { range })}
              avg30ColorClass={getRangeColorClass(s?.avg30, { range })}
              avg7Hint={getRangeHint("bpm", { range }, ctx.t, ctx.fmt.number)}
              avg30Hint={getRangeHint("bpm", { range }, ctx.t, ctx.fmt.number)}
              slope30={s?.slope30 ?? null}
              trend7Delta={summaryToTrend7Delta(s)}
              icon={TrendingUp}
              directionSentiment={ctx.directionOf(type)}
              compareBaseline={ctx.compareBaseline}
              compareDelta={ctx.tileCompareDelta(s)}
              staleDays={ctx.tileStaleDays(type)}
            />
          ),
        },
      ];
    },
  },
  {
    widget: "bodyFat",
    visible: (ctx) => countOf(ctx.summaries?.BODY_FAT) > 0,
    cards: (ctx) => [
      {
        id: "bodyFat",
        node: plainCard(ctx, "bodyFat", {
          type: "BODY_FAT",
          label: ctx.t("dashboard.bodyFatShort"),
          unit: "%",
          icon: Percent,
        }),
      },
    ],
  },
  {
    widget: "mood",
    visible: (ctx) => countOf(ctx.moodSummary) > 0,
    cards: (ctx) => {
      const s = ctx.moodSummary;
      return [
        {
          id: "mood",
          node: (
            <TrendCard
              key="mood"
              label={ctx.t("dashboard.moodShort")}
              latest={s?.latest ?? null}
              unit="/ 5"
              avg7={s?.avg7 ?? null}
              avg30={s?.avg30 ?? null}
              slope30={s?.slope30 ?? null}
              trend7Delta={summaryToTrend7Delta(s)}
              icon={Smile}
              directionSentiment={ctx.directionOf("MOOD")}
              compareBaseline={ctx.compareBaseline}
              compareDelta={ctx.tileCompareDelta(s)}
            />
          ),
        },
      ];
    },
  },
  {
    widget: "sleep",
    visible: (ctx) => countOf(ctx.summaries?.SLEEP_DURATION) > 0,
    cards: (ctx) => {
      // The summary carries per-night time asleep in MINUTES; the tile reads
      // hours, so every value field converts while the staleness and count
      // metadata stay as they are.
      const raw = ctx.summaries?.SLEEP_DURATION;
      const s = raw ? toHoursSummary(raw) : undefined;
      const discrepancy = ctx.data?.sleepSourceDiscrepancy;
      return [
        {
          id: "sleep",
          node: (
            <TrendCard
              key="sleep"
              label={ctx.t("dashboard.sleepShort") ?? "Sleep"}
              latest={s?.latest ?? null}
              unit="h"
              avg7={s?.avg7 ?? null}
              avg30={s?.avg30 ?? null}
              slope30={s?.slope30 ?? null}
              trend7Delta={summaryToTrend7Delta(s)}
              icon={Moon}
              directionSentiment={ctx.directionOf("SLEEP_DURATION")}
              compareBaseline={ctx.compareBaseline}
              compareDelta={ctx.tileCompareDelta(s)}
              staleDays={ctx.tileStaleDays("SLEEP_DURATION")}
              // A discreet "sources disagree" marker beside the headline
              // when two writers reported clearly different totals for the
              // latest night. Null on the ordinary path: no layout change.
              valueAdornment={
                discrepancy ? (
                  <SleepSourceDiscrepancyMarker discrepancy={discrepancy} />
                ) : null
              }
            />
          ),
        },
      ];
    },
  },
  {
    // Steps are activity data tied to the workouts module; only an explicit
    // `false` hides them (fail-open).
    widget: "steps",
    visible: (ctx) =>
      countOf(ctx.summaries?.ACTIVITY_STEPS) > 0 &&
      ctx.user?.modules?.workouts !== false,
    cards: (ctx) => [
      {
        id: "steps",
        node: plainCard(ctx, "steps", {
          type: "ACTIVITY_STEPS",
          label: ctx.t("dashboard.stepsShort") ?? "Steps",
          unit: "",
          icon: Footprints,
          fractionDigits: 0,
        }),
      },
    ],
  },
  {
    widget: "vo2Max",
    visible: (ctx) => countOf(ctx.summaries?.VO2_MAX) > 0,
    cards: (ctx) => [
      {
        id: "vo2Max",
        node: plainCard(ctx, "vo2Max", {
          type: "VO2_MAX",
          label: ctx.t("dashboard.vo2MaxShort") ?? "VO₂ max",
          unit: ctx.t("dashboard.vo2MaxUnit") ?? "mL/(kg·min)",
          icon: Gauge,
        }),
      },
    ],
  },
  {
    // HRV is stored under two types (SDNN from Apple Health / Health Connect,
    // nightly RMSSD from rings and straps); `pickHrvSummary` names the one
    // shown, and the label, the direction and the freshness caption follow
    // it. Each series has its OWN label key, never a base label with the
    // measure appended: the label renders truncated on one line, and an
    // appended marker is the first thing a longer locale drops.
    widget: "hrv",
    visible: (ctx) => countOf(ctx.hrv.summary) > 0,
    cards: (ctx) => {
      const { summary: s, type, labelKey } = ctx.hrv;
      return [
        {
          id: "hrv",
          node: (
            <TrendCard
              key="hrv"
              fractionDigits={0}
              label={ctx.t(labelKey)}
              latest={s?.latest ?? null}
              unit="ms"
              avg7={s?.avg7 ?? null}
              avg30={s?.avg30 ?? null}
              slope30={s?.slope30 ?? null}
              trend7Delta={summaryToTrend7Delta(s)}
              icon={HeartPulse}
              directionSentiment={ctx.directionOf(type)}
              compareBaseline={ctx.compareBaseline}
              compareDelta={ctx.tileCompareDelta(s)}
              staleDays={ctx.tileStaleDays(type)}
            />
          ),
        },
      ];
    },
  },
  {
    widget: "oxygenSaturation",
    visible: (ctx) => countOf(ctx.summaries?.OXYGEN_SATURATION) > 0,
    cards: (ctx) => [
      {
        id: "oxygenSaturation",
        node: plainCard(ctx, "oxygenSaturation", {
          type: "OXYGEN_SATURATION",
          label: ctx.t("measurements.typeOxygenSaturation"),
          unit: "%",
          icon: Droplets,
        }),
      },
    ],
  },
  {
    widget: "respiratoryRate",
    visible: (ctx) => countOf(ctx.summaries?.RESPIRATORY_RATE) > 0,
    cards: (ctx) => [
      {
        id: "respiratoryRate",
        node: plainCard(ctx, "respiratoryRate", {
          type: "RESPIRATORY_RATE",
          label: ctx.t("measurements.typeRespiratoryRate"),
          unit: ctx.t("insights.units.respiratoryRate"),
          icon: Wind,
        }),
      },
    ],
  },
  {
    widget: "wristTemperature",
    visible: (ctx) => countOf(ctx.summaries?.WRIST_TEMPERATURE) > 0,
    cards: (ctx) => [
      {
        id: "wristTemperature",
        node: plainCard(ctx, "wristTemperature", {
          type: "WRIST_TEMPERATURE",
          label: ctx.t("measurements.typeWristTemperature"),
          unit: ctx.unitDisplay.unitFor("WRIST_TEMPERATURE"),
          icon: Thermometer,
          display: true,
        }),
      },
    ],
  },
  {
    widget: "muscleMass",
    visible: (ctx) => countOf(ctx.summaries?.MUSCLE_MASS) > 0,
    cards: (ctx) => [
      {
        id: "muscleMass",
        node: plainCard(ctx, "muscleMass", {
          type: "MUSCLE_MASS",
          label: ctx.t("measurements.typeMuscleMass"),
          unit: ctx.unitDisplay.unitFor("MUSCLE_MASS"),
          icon: Dumbbell,
          display: true,
        }),
      },
    ],
  },
  {
    widget: "totalBodyWater",
    visible: (ctx) => countOf(ctx.summaries?.TOTAL_BODY_WATER) > 0,
    cards: (ctx) => [
      {
        id: "totalBodyWater",
        node: plainCard(ctx, "totalBodyWater", {
          type: "TOTAL_BODY_WATER",
          label: ctx.t("measurements.typeTotalBodyWater"),
          unit: ctx.unitDisplay.unitFor("TOTAL_BODY_WATER"),
          icon: Droplet,
          display: true,
        }),
      },
    ],
  },
  {
    widget: "boneMass",
    visible: (ctx) => countOf(ctx.summaries?.BONE_MASS) > 0,
    cards: (ctx) => [
      {
        id: "boneMass",
        node: plainCard(ctx, "boneMass", {
          type: "BONE_MASS",
          label: ctx.t("measurements.typeBoneMass"),
          unit: ctx.unitDisplay.unitFor("BONE_MASS"),
          icon: Bone,
          display: true,
        }),
      },
    ],
  },
  {
    // Fluid intake: a synthetic summary key derived server-side from the
    // nutrient days. Neutral sentiment, since more water is not simply better.
    widget: "waterIntake",
    visible: (ctx) => countOf(ctx.summaries?.NUTRIENT_WATER) > 0,
    cards: (ctx) => [
      {
        id: "waterIntake",
        node: plainCard(ctx, "waterIntake", {
          type: "NUTRIENT_WATER",
          label: ctx.t("nutrients.names.water"),
          unit: "mL",
          icon: GlassWater,
        }),
      },
    ],
  },
  {
    // Blood pressure in target. Hidden while every window reads zero, so a
    // literal "0 %" never rides the dashboard; the headline is the trailing
    // 90-day share, the label names the effective span until 90 days of
    // history exist, and below the confidence floor the tile says it is
    // still collecting instead of printing a figure.
    widget: "bpInTarget",
    visible: (ctx) =>
      ctx.data?.bpInTargetPct != null &&
      [
        ctx.data?.bpInTargetPct,
        ctx.data?.bpInTargetPct7d,
        ctx.data?.bpInTargetPct30d,
        ctx.data?.bpInTargetPctAllTime,
      ].some((pct) => pct != null && pct > 0),
    cards: (ctx) => {
      const data = ctx.data;
      const bp7 = data?.bpInTargetPct7d ?? null;
      const bp30 = data?.bpInTargetPct30d ?? null;
      const bpPriorMonth = data?.bpInTargetPctPriorMonth ?? null;
      const bpPriorYear = data?.bpInTargetPctPriorYear ?? null;
      const bpTrendDelta = bp7 !== null && bp30 !== null ? bp7 - bp30 : null;
      const bpComparePrior =
        ctx.compareBaseline === "lastMonth"
          ? bpPriorMonth
          : ctx.compareBaseline === "lastYear"
            ? bpPriorYear
            : null;
      const bpCompareDelta =
        ctx.compareBaseline === "none" ||
        bp30 === null ||
        bpComparePrior === null
          ? null
          : Math.round((bp30 - bpComparePrior) * 10) / 10;
      const bpCount90 = data?.bpInTargetCount90 ?? null;
      const bpSpanDays90 = data?.bpInTargetSpanDays90 ?? null;
      const bpSufficient = bpCount90 === null || isWindowSufficient(bpCount90);
      const bpLabel =
        bpSpanDays90 != null
          ? ctx.t("dashboard.bpInTargetWindowDynamic", { days: bpSpanDays90 })
          : ctx.t("dashboard.bpInTargetWindow90");
      return [
        {
          id: "bpInTarget",
          node: (
            <TrendCard
              key="bpInTarget"
              label={bpLabel}
              latest={bpSufficient ? (data?.bpInTargetPct ?? null) : null}
              emptyHint={
                bpSufficient ? null : ctx.t("dashboard.bpInTargetCollecting")
              }
              unit="%"
              avg7={bpSufficient ? bp7 : null}
              avg30={bpSufficient ? bp30 : null}
              slope30={null}
              trend7Delta={bpSufficient ? bpTrendDelta : null}
              icon={Target}
              directionSentiment={ctx.directionOf("BLOOD_PRESSURE_IN_TARGET")}
              compareBaseline={ctx.compareBaseline}
              compareDelta={bpSufficient ? bpCompareDelta : null}
            />
          ),
        },
      ];
    },
  },
  {
    // One card per meal-time bucket, kept together in a block.
    widget: "glucose",
    visible: (ctx) => ctx.glucoseTiles.length > 0,
    cards: (ctx) =>
      ctx.glucoseTiles.map(({ bucket, labelKey, summary: s }, idx) => {
        const unit = ctx.displayGlucoseUnit;
        const convert = (v: number | null | undefined) =>
          v != null ? convertGlucose(v, unit) : null;
        return {
          id: `glucose-${bucket}`,
          orderOffset: idx / 1000,
          node: (
            <TrendCard
              key={`glucose-${bucket}`}
              label={ctx.t(labelKey)}
              latest={convert(s.latest)}
              unit={unit}
              fractionDigits={glucoseFractionDigits(unit)}
              avg7={convert(s.avg7)}
              avg30={convert(s.avg30)}
              slope30={s.slope30 ?? null}
              icon={Droplet}
              staleDays={ctx.tileStaleDays("BLOOD_GLUCOSE")}
            />
          ),
        };
      }),
  },
];

/**
 * The strip's cards for this render: every tile whose layout toggle is on and
 * whose own rule passes, sorted by layout order.
 */
export function buildStripEntries(ctx: DashboardTileContext): StripEntry[] {
  const entries: StripEntry[] = [];
  for (const tile of STRIP_TILES) {
    if (!ctx.isTileVisible(tile.widget) || !tile.visible(ctx)) continue;
    const order = ctx.widgetOrder(tile.widget);
    for (const card of tile.cards(ctx)) {
      entries.push({
        id: card.id,
        order: order + (card.orderOffset ?? 0),
        node: card.node,
      });
    }
  }
  entries.sort((a, b) => a.order - b.order);
  return entries;
}
