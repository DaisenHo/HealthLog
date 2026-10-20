/**
 * v1.4.16 — comparison overlay helper.
 *
 * The dashboard charts already fetch every measurement for the active
 * type set (paged through `/api/measurements`). When the comparison
 * toggle is active we re-use the SAME daily aggregates and shift them
 * forward by 30 days (lastMonth) or 365 days (lastYear) so the prior
 * period lines up with the current period on the visible x-axis.
 *
 * The shift is integer-day exact because the dashboard's daily bucket
 * keys live at UTC noon of each Berlin calendar day — adding or
 * subtracting 30 / 365 days at noon does NOT cross a DST boundary
 * (only 02:00-03:00 wall-clock crossings can flip the calendar day).
 *
 * Pure & deterministic: the helper takes the already-bucketed
 * `[timestamp, value]` rows the chart computes, and emits a parallel
 * series with timestamps shifted forward and values intact. The chart
 * then merges the two series by visible-day so a single Recharts
 * tooltip can render both at once.
 */
export type ComparisonShift = "lastMonth" | "lastYear";

/** Days the shift moves the prior period forward by. */
export const COMPARISON_SHIFT_DAYS: Record<ComparisonShift, number> = {
  lastMonth: 30,
  lastYear: 365,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Shift a daily-aggregated series forward by the comparison span so
 * each prior-period point lines up with its current-period sibling on
 * the same visible x-axis position. The shift adds days, never
 * subtracts: a "last month" shift on a Jan 15 prior-period point lands
 * the resulting overlay row at Feb 14 — directly under the current Feb
 * 14 reading where the user expects to see the comparison.
 *
 * Empty input → empty output. The chart's empty-state then handles
 * "Comparison unavailable — no data from last month yet" without the
 * helper having to know about i18n.
 */
export function shiftDailySeriesForward<T extends { timestamp: number }>(
  rows: T[],
  shift: ComparisonShift,
): T[] {
  const days = COMPARISON_SHIFT_DAYS[shift];
  return rows.map((row) => ({
    ...row,
    timestamp: row.timestamp + days * MS_PER_DAY,
  }));
}

/**
 * Compute the average value of a numeric series over the entire window.
 * Returns null when the series has no points so the caller can render
 * "comparison unavailable" instead of a misleading 0.
 *
 * Used by the tile delta callout: each tile sums the current-period
 * average and the prior-period average so the difference is what the
 * user sees in the chart, not a single-day cherry-pick.
 */
export function averageValue(
  values: Array<number | null | undefined>,
): number | null {
  let sum = 0;
  let n = 0;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  if (n === 0) return null;
  return sum / n;
}

/**
 * Compute the delta between the current-period average and the prior-
 * period average. Returns null when either side is missing data so the
 * caller can render the unavailable fallback. Otherwise returns
 * `current - prior` as a signed number — sign convention matches the
 * dashboard's existing trend arrows (positive = up).
 */
export function computeComparisonDelta(
  current: number | null,
  prior: number | null,
): number | null {
  if (current === null || prior === null) return null;
  return current - prior;
}
