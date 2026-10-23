"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { RichChartTooltip } from "@/components/charts/chart-tooltip";

export interface SideBySideSeries {
  key: string;
  label: string;
  /** A `var(--chart-N)` expression. */
  color: string;
  /** Day index from the window's first day, and the value in display units. */
  points: Array<{ x: number; y: number }>;
  /** The usual range in display units, shaded behind the line. */
  band: { low: number; high: number } | null;
}

const AXIS_TICK = { fontSize: 11, fill: "var(--muted-foreground)" };
const ROW_HEIGHT = 88;
const AXIS_HEIGHT = 24;

/**
 * Up to three signals stacked on one time axis, each with its usual range
 * shaded, so a reader sees two lines move together before reading that they
 * do. Each row keeps its own scale; the axis, the grid and the band follow the
 * metric charts. Values arrive in display units, already converted.
 */
export function TopicSideBySideChart({
  series,
  days,
  formatDay,
  formatValue,
  formatTick,
}: {
  series: SideBySideSeries[];
  /** Days in the window; the axis runs from 0 to `days - 1`. */
  days: number;
  formatDay: (x: number) => string;
  /** A value with its unit, for the tooltip. */
  formatValue: (key: string, value: number) => string;
  /** A bare axis number. */
  formatTick: (key: string, value: number) => string;
}) {
  const ticks = [0, Math.round((days - 1) / 2), days - 1];
  return (
    <div className="flex flex-col gap-2">
      {series.map((s, index) => {
        const last = index === series.length - 1;
        return (
          <div key={s.key} data-slot="topic-chart-row" data-signal={s.key}>
            <p className="text-foreground flex items-center gap-2 text-xs font-medium">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </p>
            <div style={{ height: ROW_HEIGHT + (last ? AXIS_HEIGHT : 0) }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={s.points}
                  margin={{ top: 6, right: 8, bottom: 0, left: 0 }}
                  syncId="topic-side-by-side"
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    opacity={0.5}
                    vertical={false}
                  />
                  <XAxis
                    type="number"
                    dataKey="x"
                    domain={[0, Math.max(1, days - 1)]}
                    ticks={ticks}
                    hide={!last}
                    height={last ? AXIS_HEIGHT : 0}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatDay(Number(value))}
                  />
                  <YAxis
                    domain={["auto", "auto"]}
                    width={44}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    tickCount={3}
                    tickFormatter={(value) =>
                      typeof value === "number" ? formatTick(s.key, value) : ""
                    }
                  />
                  {s.band ? (
                    <ReferenceArea
                      y1={s.band.low}
                      y2={s.band.high}
                      fill="var(--success)"
                      fillOpacity={0.12}
                      strokeOpacity={0}
                      ifOverflow="extendDomain"
                    />
                  ) : null}
                  <Tooltip
                    cursor={{ stroke: "var(--border)" }}
                    content={({ active, payload }) => {
                      const point = payload?.[0]?.payload as
                        { x: number; y: number } | undefined;
                      if (!active || !point) return null;
                      return (
                        <RichChartTooltip
                          active
                          label={formatDay(point.x)}
                          rows={[
                            {
                              name: s.label,
                              value: formatValue(s.key, point.y),
                              color: s.color,
                            },
                          ]}
                        />
                      );
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="y"
                    name={s.label}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={s.points.length <= 31 ? { r: 2 } : false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
