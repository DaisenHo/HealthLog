import { describe, it, expect } from "vitest";
import { computeWindowTrend, SPLIT_HALF_THRESHOLD_DAYS } from "../window-trend";

/**
 * v1.4.16 — chart trend overlay on the "All" filter.
 *
 * Maintainer report: clicking the All range button on a multi-year metric
 * displays "+0.0 kg/Woche" because the per-week delta rounds to zero
 * once the window is years wide. The split-half delta keeps the trend
 * legible by reporting the change between the first-half mean and the
 * second-half mean of the visible series — a number that cannot round
 * to zero unless the metric truly didn't move.
 */

describe("computeWindowTrend()", () => {
  it("returns null for an empty / single-point series", () => {
    expect(
      computeWindowTrend({ rawValues: [], trendValues: [], windowDays: 0 }),
    ).toBeNull();
    expect(
      computeWindowTrend({
        rawValues: [80],
        trendValues: [80],
        windowDays: 0,
      }),
    ).toBeNull();
  });

  it("returns null when raw / trend lengths disagree (programmer error)", () => {
    expect(
      computeWindowTrend({
        rawValues: [80, 81, 82],
        trendValues: [80, 81],
        windowDays: 30,
      }),
    ).toBeNull();
  });

  it("computes a per-week delta for short windows (< threshold)", () => {
    // 7 days, slope of +1 per week → weeklyDelta = +1
    const result = computeWindowTrend({
      rawValues: [80, 80.5, 81],
      trendValues: [80, 80.5, 81],
      windowDays: 7,
    });
    expect(result).not.toBeNull();
    expect(result?.weeklyDelta).toBeCloseTo(1, 3);
    // Below the split-half threshold — no second-half computation.
    expect(result?.splitHalfDelta).toBeNull();
  });

  it("on the threshold boundary: split-half kicks in at exactly 90 days", () => {
    const result = computeWindowTrend({
      rawValues: [80, 81, 82, 83],
      trendValues: [80, 81, 82, 83],
      windowDays: SPLIT_HALF_THRESHOLD_DAYS,
    });
    expect(result?.splitHalfDelta).not.toBeNull();
  });

  it("computes a meaningful split-half delta for a long ('All') window", () => {
    // ~3 years of synthetic data, +0.3 kg per month average rise. The
    // per-week rate is small (~0.07 kg/week) which rounds to 0.1 in
    // the 1-decimal formatter — and the test in the chart wrapper is
    // about whether ANY signal survives. The split-half delta ≈ +5 kg
    // is the kind of number the maintainer actually wants to see.
    const months = 36;
    const rawValues = Array.from({ length: months }, (_, i) => 80 + 0.3 * i);
    const trendValues = rawValues; // perfectly linear, trend === raw
    const windowDays = months * 30;

    const result = computeWindowTrend({ rawValues, trendValues, windowDays });
    expect(result).not.toBeNull();
    expect(result?.splitHalfDelta).not.toBeNull();
    // First half mean ≈ 80 + 0.3*8.5 = 82.55; second half ≈ 80 + 0.3*26.5 = 87.95
    // → delta ≈ 5.4 kg, definitively non-zero.
    expect(result?.splitHalfDelta ?? 0).toBeGreaterThan(3);
  });

  it("split-half delta is exactly zero for a flat series even on a long window", () => {
    // Confirms we don't fabricate movement where there is none — the
    // split-half is the *mean* delta, so identical halves yield 0.
    const flat = Array(50).fill(80);
    const result = computeWindowTrend({
      rawValues: flat,
      trendValues: flat,
      windowDays: 365 * 2,
    });
    expect(result?.splitHalfDelta).toBe(0);
    expect(result?.weeklyDelta).toBe(0);
  });

  it("respects an overridden split-half threshold (param injection)", () => {
    // Caller wants split-half from day 30.
    const result = computeWindowTrend(
      {
        rawValues: [80, 81, 82, 83, 84, 85],
        trendValues: [80, 81, 82, 83, 84, 85],
        windowDays: 30,
      },
      30,
    );
    expect(result?.splitHalfDelta).not.toBeNull();
  });

  it("first-half/second-half split halves of a 6-point series", () => {
    // Values: [70, 71, 72, 80, 81, 82]
    // First half mean = (70+71+72)/3 = 71
    // Second half mean = (80+81+82)/3 = 81
    // Δ = 10
    const result = computeWindowTrend({
      rawValues: [70, 71, 72, 80, 81, 82],
      trendValues: [70, 71, 72, 80, 81, 82],
      windowDays: 365,
    });
    expect(result?.splitHalfDelta).toBeCloseTo(10, 3);
  });
});
