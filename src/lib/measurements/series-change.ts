/**
 * The first-to-last change of a chart window, by day (v1.43, ios #116
 * item 3).
 *
 * A chart's change is read off day values, not off single points: the first
 * reading of a window can be an outlier minute of a dense series, and a day
 * of steps is its total, not its last sample. Each local day of the window is
 * reduced with the type's own day statistic (the total for a summed type, the
 * mean of the hours' means for pulse, the mean otherwise), and the change is
 * the last day against the first. Under two days there is no change to show.
 *
 * Pure: the series route hands over the points it already serves, in the
 * unit it serves them in.
 */
import { dayValue } from "@/lib/measurements/day-mean";
import { isCumulativeDaySumType } from "@/lib/measurements/cumulative-day-sum";
import {
  trendSentimentOf,
  type TrendSentiment,
  type TrendVerdict,
} from "@/lib/targets/trend-verdict";
import { userDayKey } from "@/lib/tz/format";

export interface SeriesChange {
  from: number;
  to: number;
  delta: number;
  sentiment: TrendSentiment;
}

export interface SeriesDayValue {
  day: string;
  value: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** One value per local day, oldest first. */
export function seriesDayValues(
  type: string,
  points: ReadonlyArray<{ at: string; value: number }>,
  timezone: string,
): SeriesDayValue[] {
  const byDay = new Map<string, Array<{ value: number; measuredAt: Date }>>();
  for (const point of points) {
    const measuredAt = new Date(point.at);
    if (!Number.isFinite(point.value) || Number.isNaN(measuredAt.getTime())) {
      continue;
    }
    const day = userDayKey(measuredAt, timezone);
    const list = byDay.get(day);
    if (list) list.push({ value: point.value, measuredAt });
    else byDay.set(day, [{ value: point.value, measuredAt }]);
  }
  const summed = isCumulativeDaySumType(type);
  const out: SeriesDayValue[] = [];
  for (const [day, rows] of byDay) {
    const value = summed
      ? rows.reduce((sum, r) => sum + r.value, 0)
      : dayValue(type, rows, timezone);
    if (value !== null) out.push({ day, value });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function computeSeriesChange(
  days: readonly SeriesDayValue[],
  verdict: TrendVerdict | null,
): SeriesChange | null {
  if (days.length < 2) return null;
  const from = round2(days[0].value);
  const to = round2(days[days.length - 1].value);
  const delta = round2(to - from);
  return { from, to, delta, sentiment: trendSentimentOf(delta, verdict) };
}

/**
 * The value a window's verdict places against the band: the mean of its last
 * seven day values (the dashboard places the seven-day average the same way),
 * so one day near a band edge does not flip the colour.
 */
export function seriesReferenceValue(
  days: readonly SeriesDayValue[],
): number | null {
  if (days.length === 0) return null;
  const recent = days.slice(-7);
  return recent.reduce((sum, d) => sum + d.value, 0) / recent.length;
}
