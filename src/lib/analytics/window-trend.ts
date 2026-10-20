/**
 * Window-trend helpers for the health-chart `showTrend` overlay.
 *
 * Two complementary deltas:
 *
 *   - `weeklyDelta`     — first vs last regression-line value, normalised
 *                         to a per-week rate. Stable for short windows
 *                         (≤ 90 days) where the user is asking "what is
 *                         this metric doing this week / month".
 *   - `splitHalfDelta`  — mean of the second half minus mean of the first
 *                         half of the visible series. Stays meaningful
 *                         for long ("All") ranges where the per-week rate
 *                         rounds to ±0 in the 1-decimal formatter.
 *
 * v1.4.16 — the maintainer reported the chart trend overlay reads
 * "+0.0 kg/Woche" on the All filter, even when their weight clearly
 * shifted across years. Root cause: `weeklyDelta = (last − first) / days
 * × 7` is mathematically correct but visually rounds to zero whenever
 * the slope-per-day is small enough that 7× still falls below the
 * formatter's display precision. The split-half delta side-steps the
 * rounding entirely because it doesn't divide by the window width.
 *
 * Pure & deterministic — pinned by unit test.
 */

export interface WindowTrendInput {
  /** Sorted ascending by timestamp. */
  rawValues: number[];
  /** Sorted ascending by timestamp. Must align 1:1 with `rawValues`. */
  trendValues: number[];
  /** Days between the first and last point of the visible series. */
  windowDays: number;
}

export interface WindowTrendResult {
  /** Linear-trend per-week delta. Always present when ≥ 2 points. */
  weeklyDelta: number;
  /**
   * First-half-mean vs second-half-mean delta of the raw (not trend)
   * values. Reported as `null` for short windows or when one of the
   * halves is empty (n < 2 split into two halves).
   */
  splitHalfDelta: number | null;
}

/** Default threshold above which the split-half delta is computed. */
export const SPLIT_HALF_THRESHOLD_DAYS = 90;

export function computeWindowTrend(
  input: WindowTrendInput,
  splitHalfThresholdDays = SPLIT_HALF_THRESHOLD_DAYS,
): WindowTrendResult | null {
  if (input.rawValues.length < 2) return null;
  if (input.trendValues.length !== input.rawValues.length) return null;
  if (!Number.isFinite(input.windowDays) || input.windowDays <= 0) return null;

  const firstTrend = input.trendValues[0];
  const lastTrend = input.trendValues[input.trendValues.length - 1];
  const weeklyDelta = ((lastTrend - firstTrend) / input.windowDays) * 7;

  let splitHalfDelta: number | null = null;
  if (input.windowDays >= splitHalfThresholdDays) {
    const mid = Math.floor(input.rawValues.length / 2);
    const firstHalf = input.rawValues.slice(0, mid);
    const secondHalf = input.rawValues.slice(mid);
    if (firstHalf.length > 0 && secondHalf.length > 0) {
      const meanFirst =
        firstHalf.reduce((sum, value) => sum + value, 0) / firstHalf.length;
      const meanSecond =
        secondHalf.reduce((sum, value) => sum + value, 0) / secondHalf.length;
      splitHalfDelta = meanSecond - meanFirst;
    }
  }

  return { weeklyDelta, splitHalfDelta };
}
