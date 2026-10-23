"use client";

/**
 * The reference layers and series inside `HealthChart`'s plot.
 *
 * Each is a plain function that returns the Recharts elements (never a
 * component wrapping them), so the plot's child list is exactly the list of
 * elements it always was: Recharts lays its layers out in source order, and a
 * wrapper component would change what it sees.
 */
import {
  Area,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
} from "recharts";

import { OPEN_DAY_LINE } from "@/components/day/chart-day-links";
import type { ComparisonBaseline } from "@/lib/dashboard-layout";

import type { ResolvedAnnotation, ResolvedVerticalMarker } from "./series-math";
import type { ChartDataPoint, VisibleTargetZone } from "./types";

type Translate = (key: string) => string;

/** Target zones: the shaded area, then the dashed low and high edges. */
export function targetZoneLayers(
  zones: VisibleTargetZone[],
  maxPointIndex: number,
) {
  return [
    zones.map((zone) => (
      <ReferenceArea
        key={`${zone.key}-fill`}
        x1={0}
        x2={maxPointIndex}
        y1={zone.low}
        y2={zone.high}
        fill={zone.color}
        fillOpacity={zone.opacity}
        strokeOpacity={0}
        ifOverflow="discard"
      />
    )),
    zones.map((zone) => (
      <ReferenceLine
        key={`${zone.key}-low`}
        y={zone.low}
        stroke={zone.color}
        strokeDasharray="6 4"
        strokeWidth={1.75}
        strokeOpacity={zone.lineOpacity}
      />
    )),
    zones.map((zone) => (
      <ReferenceLine
        key={`${zone.key}-high`}
        y={zone.high}
        stroke={zone.color}
        strokeDasharray="6 4"
        strokeWidth={1.75}
        strokeOpacity={zone.lineOpacity}
        label={
          zone.label
            ? {
                value: zone.label,
                position: "right",
                fill: zone.textColor ?? zone.color,
                fontSize: 10,
              }
            : undefined
        }
      />
    )),
  ];
}

/**
 * Storyboard annotations: a vertical line on the visible point with its label
 * above, truncated to 24 characters below 640 px.
 */
export function annotationLayers(
  annotations: ResolvedAnnotation[],
  viewportWidth: number,
) {
  return annotations.map((annotation, i) => (
    <ReferenceLine
      key={`storyboard-${i}-${annotation.pointIndex}`}
      x={annotation.pointIndex}
      stroke={annotation.color}
      strokeDasharray="4 4"
      strokeWidth={1.25}
      strokeOpacity={0.7}
      ifOverflow="discard"
      label={{
        value:
          viewportWidth < 640 ? annotation.truncatedLabel : annotation.label,
        position: "insideTopRight",
        fill: annotation.color,
        fontSize: 10,
        fontWeight: 500,
      }}
    />
  ));
}

/**
 * Event markers: a thin dashed line and a dot where it meets the x axis, so a
 * row of them reads as a cadence. A label only when the caller gave one.
 */
export function verticalMarkerLayers(
  markers: ResolvedVerticalMarker[],
  yDomain: [number, number] | undefined,
) {
  return [
    markers.map((marker, i) => (
      <ReferenceLine
        key={`vmarker-${i}-${marker.pointIndex}`}
        x={marker.pointIndex}
        stroke={marker.color}
        strokeDasharray="3 3"
        strokeWidth={1.1}
        strokeOpacity={0.55}
        ifOverflow="discard"
        label={
          marker.label
            ? {
                value: marker.label,
                position: "insideTopRight",
                fill: marker.color,
                fontSize: 10,
                fontWeight: 500,
              }
            : undefined
        }
      />
    )),
    yDomain &&
      markers.map((marker, i) => (
        <ReferenceDot
          key={`vmarker-dot-${i}-${marker.pointIndex}`}
          x={marker.pointIndex}
          y={yDomain[0]}
          r={3}
          fill={marker.color}
          stroke="none"
          ifOverflow="discard"
        />
      )),
  ];
}

/**
 * The open day: a dashed line through it and a ring on each of its values,
 * so the point the day panel describes stays in sight beside it.
 */
export function openDayLayers(
  openDayIndex: number | undefined,
  openDayPoint: ChartDataPoint | undefined,
  types: string[],
  colors: string[],
) {
  return [
    openDayIndex !== undefined ? (
      <ReferenceLine key="open-day" x={openDayIndex} {...OPEN_DAY_LINE} />
    ) : null,
    openDayIndex !== undefined && openDayPoint
      ? types.map((type, i) => {
          const v = openDayPoint[type];
          if (typeof v !== "number") return null;
          return (
            <ReferenceDot
              key={`open-day-${type}`}
              x={openDayIndex}
              y={v}
              r={6.5}
              fill="var(--card)"
              stroke={colors[i % colors.length]}
              strokeWidth={2.5}
              ifOverflow="discard"
            />
          );
        })
      : null,
  ];
}

/**
 * The personal baseline per type, only while the trend overlay is shown (an
 * always-on mean line was rejected). Only the first type carries the label,
 * so a multi-type chart does not paint it twice.
 */
export function baselineLayers(
  showTrend: boolean,
  types: string[],
  colors: string[],
  personalBaselines: Map<string, number>,
  t: Translate,
) {
  return (
    showTrend &&
    types.map((type, i) => {
      const baseline = personalBaselines.get(type);
      if (baseline == null) return null;
      return (
        <ReferenceLine
          key={`baseline-${type}`}
          y={baseline}
          stroke={colors[i % colors.length]}
          strokeDasharray="2 4"
          strokeOpacity={0.4}
          strokeWidth={1}
          ifOverflow="discard"
          label={
            i === 0
              ? {
                  value: t("charts.personalBaseline"),
                  position: "insideTopLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 10,
                  opacity: 0.7,
                }
              : undefined
          }
        />
      );
    })
  );
}

/**
 * The series, in paint order: the min–max range band behind the mean line
 * (not in mini mode, and only with the target-range toggle, which controls
 * both bands), the lines, the dashed 7-day average, the trend line, and the
 * dimmed prior period (thinner and at 45 % so the current line reads first).
 */
export function seriesLayers({
  types,
  colors,
  label,
  t,
  mini,
  showBands,
  showMA,
  showTrend,
  compareBaseline,
  hasComparisonData,
  animationsEnabled,
}: {
  types: string[];
  colors: string[];
  label: (type: string) => string;
  t: Translate;
  mini: boolean;
  showBands: boolean;
  showMA: boolean;
  showTrend: boolean;
  compareBaseline: ComparisonBaseline;
  hasComparisonData: boolean;
  animationsEnabled: boolean;
}) {
  return [
    !mini &&
      showBands &&
      types.map((type, i) => (
        <Area
          key={`${type}__range`}
          type="monotone"
          dataKey={`${type}__range`}
          name={`${label(type)} (${t("charts.rangeBand")})`}
          stroke="none"
          fill={colors[i % colors.length]}
          fillOpacity={0.12}
          connectNulls
          isAnimationActive={animationsEnabled}
          legendType="none"
          tooltipType="none"
        />
      )),
    types.map((type, i) => (
      <Line
        key={type}
        type="monotone"
        dataKey={type}
        name={label(type)}
        stroke={colors[i % colors.length]}
        strokeWidth={2}
        dot={{ r: 3, fill: colors[i % colors.length] }}
        activeDot={{ r: 5 }}
        connectNulls
        isAnimationActive={animationsEnabled}
        animationDuration={animationsEnabled ? 600 : 0}
        animationEasing="ease-out"
      />
    )),
    showMA &&
      types.map((type, i) => (
        <Line
          key={`${type}_ma`}
          type="monotone"
          dataKey={`${type}_ma`}
          name={`${label(type)} (${t("charts.movingAverage7d")})`}
          stroke={colors[i % colors.length]}
          strokeWidth={1.5}
          strokeDasharray="5 5"
          strokeOpacity={0.7}
          dot={false}
          connectNulls
        />
      )),
    showTrend &&
      types.map((type) => (
        <Line
          key={`${type}_trend`}
          type="linear"
          dataKey={`${type}_trend`}
          name={`${label(type)} (${t("charts.trend")})`}
          stroke="var(--muted-foreground)"
          strokeWidth={1}
          strokeDasharray="8 4"
          dot={false}
          connectNulls
        />
      )),
    compareBaseline !== "none" &&
      hasComparisonData &&
      types.map((type, i) => (
        <Line
          key={`${type}_compare`}
          type="monotone"
          dataKey={`${type}_compare`}
          name={`${label(type)} (${t(
            compareBaseline === "lastMonth"
              ? "comparison.captionLastMonth"
              : "comparison.captionLastYear",
          )})`}
          stroke={colors[i % colors.length]}
          strokeWidth={1.25}
          strokeDasharray="4 3"
          strokeOpacity={0.45}
          dot={false}
          connectNulls
          isAnimationActive={animationsEnabled}
          animationDuration={animationsEnabled ? 600 : 0}
          animationEasing="ease-out"
          legendType="none"
          data-slot={`chart-compare-line-${type}`}
        />
      )),
  ];
}
