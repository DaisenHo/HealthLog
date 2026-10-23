/**
 * The arithmetic of the topic pages, over day-keyed series. Pure: the reads
 * live in `read.ts`, the assembly in `build.ts`.
 *
 * Nothing here invents a figure. A usual range needs a week of days, a trend
 * two weeks, a relationship fourteen paired days; below that the answer says
 * how many days there are and how many it needs, and carries no number that
 * would read as a finding.
 *
 *  - Usual range: the personal band the Insights tiles call "typical for
 *    you", median ± 3 scaled MAD of the daily values (`buildBaselineBand`),
 *    over the trailing {@link TOPIC_BASE_WINDOW_DAYS} days.
 *  - Trend: the least-squares slope of the daily values over the same
 *    window, reported as the change it amounts to across the window, beside
 *    weekly means for the sparkline.
 *  - Relationship: Pearson's r (two-sided p from the t statistic, the one
 *    correlation the app reports) or, for a `split`, the difference of two
 *    means with a Welch t test. A finding needs p < 0.05; otherwise it reads
 *    as "no clear link over n days". Never a cause.
 */
import type { MeasurementType } from "@/generated/prisma/enums";
import { buildBaselineBand } from "@/lib/insights/derived/baseline";
import {
  MAX_P_VALUE,
  pearson,
  twoSidedPFromT,
} from "@/lib/insights/correlations";
import { linearFit } from "@/lib/stats/linear-fit";
import { variance } from "@/lib/stats/spread";
import { daysBetweenDateKeys, shiftDateKey } from "@/lib/tz/format";

import {
  MOOD_SIGNAL,
  RELATIONSHIP_MAX_POINTS,
  RELATIONSHIP_MIN_PAIRED_DAYS,
  SPLIT_MIN_DAYS_PER_SIDE,
  TOPIC_BASE_WINDOW_DAYS,
  TREND_MIN_DAYS,
  USUAL_RANGE_MIN_DAYS,
  type TopicRelationshipDef,
  type TopicSignalKey,
} from "./registry";

/** One signal's values, keyed by local day (`YYYY-MM-DD`). */
export type DaySeries = ReadonlyMap<string, number>;

export interface DayValue {
  day: string;
  value: number;
}

export interface UsualRange {
  low: number;
  high: number;
  center: number;
  /** Days the band was built from. */
  days: number;
}

export type SignalState = "within" | "above" | "below" | "learning" | "none";

export interface TopicTrend {
  key: TopicSignalKey;
  status: "ok" | "insufficient";
  /** Days with a value in the trend window. */
  days: number;
  /** The fitted change across the window, in the signal's stored unit. */
  change: number | null;
  /** Weekly means, oldest first; a week without a value is left out. */
  weekly: DayValue[];
}

export interface SplitComparison {
  threshold: number;
  belowDays: number;
  otherDays: number;
  belowMean: number;
  otherMean: number;
  /** `belowMean − otherMean`, in `y`'s stored unit. */
  difference: number;
}

export interface TopicRelationship {
  id: string;
  x: TopicSignalKey;
  y: TopicSignalKey;
  lagDays: 0 | 1;
  kind: "correlation" | "split";
  pairedDays: number;
  requiredDays: number;
  /**
   * `insufficient`: below the paired-day floor (or one side of a split is
   * too thin). `no_clear_link`: enough days, no difference a test can tell
   * from chance. `linked`: p < 0.05, reported as a pattern, never a cause.
   */
  status: "insufficient" | "no_clear_link" | "linked";
  r: number | null;
  pValue: number | null;
  split: SplitComparison | null;
  /** Paired values for the scatter, newest kept; empty when insufficient. */
  points: Array<{ x: number; y: number }>;
}

const round = (value: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/** The days of `series` in `[fromKey, toKey]`, oldest first. */
export function windowValues(
  series: DaySeries | undefined,
  fromKey: string,
  toKey: string,
): DayValue[] {
  if (!series) return [];
  const out: DayValue[] = [];
  for (const [day, value] of series) {
    if (day >= fromKey && day <= toKey && Number.isFinite(value)) {
      out.push({ day, value });
    }
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** The newest day with a value on or before `todayKey`. */
export function latestValue(
  series: DaySeries | undefined,
  todayKey: string,
): DayValue | null {
  if (!series) return null;
  let best: DayValue | null = null;
  for (const [day, value] of series) {
    if (day > todayKey || !Number.isFinite(value)) continue;
    if (best === null || day > best.day) best = { day, value };
  }
  return best;
}

/** The first day of the trailing base window that ends on `todayKey`. */
export function baseWindowStart(todayKey: string): string {
  return shiftDateKey(todayKey, -(TOPIC_BASE_WINDOW_DAYS - 1));
}

/**
 * The personal usual range over the trailing base window, or null below
 * {@link USUAL_RANGE_MIN_DAYS} days. The mood score has no measurement type
 * and keeps the raw band edges.
 */
export function usualRange(
  key: TopicSignalKey,
  series: DaySeries | undefined,
  todayKey: string,
): UsualRange | null {
  const values = windowValues(series, baseWindowStart(todayKey), todayKey).map(
    (p) => p.value,
  );
  if (values.length < USUAL_RANGE_MIN_DAYS) return null;
  const type = key === MOOD_SIGNAL ? null : (key as MeasurementType);
  const band = buildBaselineBand(values, type);
  if (!band) return null;
  return {
    low: round(band.low, 2),
    high: round(band.high, 2),
    center: round(band.center, 2),
    days: band.sampleDays,
  };
}

/** Where a value sits against the usual range. */
export function stateAgainstRange(
  latest: DayValue | null,
  range: UsualRange | null,
): SignalState {
  if (latest === null) return "none";
  if (range === null) return "learning";
  if (latest.value > range.high) return "above";
  if (latest.value < range.low) return "below";
  return "within";
}

/** The Monday-anchored start of the week a day falls in (ISO weeks). */
function weekStart(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const sinceMonday = (weekday + 6) % 7;
  return shiftDateKey(day, -sinceMonday);
}

/**
 * The slope of the daily values over the trailing base window, as the change
 * it amounts to across the window, beside weekly means.
 */
export function computeTrend(
  key: TopicSignalKey,
  series: DaySeries | undefined,
  todayKey: string,
): TopicTrend {
  const fromKey = baseWindowStart(todayKey);
  const points = windowValues(series, fromKey, todayKey);
  const weeks = new Map<string, { sum: number; n: number }>();
  for (const p of points) {
    const week = weekStart(p.day);
    const cell = weeks.get(week) ?? { sum: 0, n: 0 };
    cell.sum += p.value;
    cell.n += 1;
    weeks.set(week, cell);
  }
  const weekly = [...weeks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([day, cell]) => ({ day, value: round(cell.sum / cell.n, 2) }));
  if (points.length < TREND_MIN_DAYS) {
    return {
      key,
      status: "insufficient",
      days: points.length,
      change: null,
      weekly,
    };
  }
  const fit = linearFit(
    points.map((p) => daysBetweenDateKeys(fromKey, p.day)),
    points.map((p) => p.value),
  );
  if (!fit) {
    return {
      key,
      status: "insufficient",
      days: points.length,
      change: null,
      weekly,
    };
  }
  return {
    key,
    status: "ok",
    days: points.length,
    change: round(fit.slope * (TOPIC_BASE_WINDOW_DAYS - 1), 2),
    weekly,
  };
}

/** `x` on day d beside `y` on day d + lag, both inside the window. */
export function pairDays(
  x: DaySeries | undefined,
  y: DaySeries | undefined,
  lagDays: number,
  fromKey: string,
  toKey: string,
): Array<{ day: string; x: number; y: number }> {
  if (!x || !y) return [];
  const out: Array<{ day: string; x: number; y: number }> = [];
  for (const { day, value } of windowValues(x, fromKey, toKey)) {
    const target = shiftDateKey(day, lagDays);
    if (target > toKey) continue;
    const yValue = y.get(target);
    if (yValue === undefined || !Number.isFinite(yValue)) continue;
    out.push({ day, x: value, y: yValue });
  }
  return out;
}

function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Welch's two-sided p for a difference of two means. */
export function welchPValue(
  a: readonly number[],
  b: readonly number[],
): number {
  const ma = mean(a);
  const mb = mean(b);
  const va = (variance(a, "sample") ?? 0) / a.length;
  const vb = (variance(b, "sample") ?? 0) / b.length;
  const se = Math.sqrt(va + vb);
  if (se === 0) return ma === mb ? 1 : 0;
  const t = Math.abs(ma - mb) / se;
  const df =
    (va + vb) ** 2 /
    ((va * va) / Math.max(1, a.length - 1) +
      (vb * vb) / Math.max(1, b.length - 1));
  return twoSidedPFromT(t, df);
}

function compareSplit(
  pairs: ReadonlyArray<{ x: number; y: number }>,
  threshold: number,
): { split: SplitComparison; pValue: number } | null {
  const below = pairs.filter((p) => p.x < threshold).map((p) => p.y);
  const other = pairs.filter((p) => p.x >= threshold).map((p) => p.y);
  if (below.length < SPLIT_MIN_DAYS_PER_SIDE) return null;
  if (other.length < SPLIT_MIN_DAYS_PER_SIDE) return null;
  const belowMean = mean(below);
  const otherMean = mean(other);
  return {
    split: {
      threshold,
      belowDays: below.length,
      otherDays: other.length,
      belowMean: round(belowMean, 2),
      otherMean: round(otherMean, 2),
      difference: round(belowMean - otherMean, 2),
    },
    pValue: welchPValue(below, other),
  };
}

/**
 * One relationship over `[fromKey, toKey]`. Below the paired-day floor it
 * reports the count and nothing else.
 */
export function computeRelationship(
  def: TopicRelationshipDef,
  x: DaySeries | undefined,
  y: DaySeries | undefined,
  fromKey: string,
  toKey: string,
): TopicRelationship {
  const pairs = pairDays(x, y, def.lagDays, fromKey, toKey);
  const base: TopicRelationship = {
    id: def.id,
    x: def.x,
    y: def.y,
    lagDays: def.lagDays,
    kind: def.kind,
    pairedDays: pairs.length,
    requiredDays: RELATIONSHIP_MIN_PAIRED_DAYS,
    status: "insufficient",
    r: null,
    pValue: null,
    split: null,
    points: [],
  };
  if (pairs.length < RELATIONSHIP_MIN_PAIRED_DAYS) return base;
  const points = pairs
    .slice(-RELATIONSHIP_MAX_POINTS)
    .map((p) => ({ x: round(p.x, 2), y: round(p.y, 2) }));

  if (def.kind === "split") {
    const compared = compareSplit(pairs, def.threshold ?? 0);
    if (!compared) return base;
    return {
      ...base,
      status: compared.pValue < MAX_P_VALUE ? "linked" : "no_clear_link",
      pValue: round(compared.pValue, 4),
      split: compared.split,
      points,
    };
  }

  const result = pearson({
    xs: pairs.map((p) => p.x),
    ys: pairs.map((p) => p.y),
    minPairs: RELATIONSHIP_MIN_PAIRED_DAYS,
  });
  if (result.status !== "ok") {
    // A flat series (no variance) is enough days and no link to report.
    return { ...base, status: "no_clear_link", points };
  }
  return {
    ...base,
    status: result.pValue < MAX_P_VALUE ? "linked" : "no_clear_link",
    r: round(result.r, 2),
    pValue: round(result.pValue, 4),
    points,
  };
}
