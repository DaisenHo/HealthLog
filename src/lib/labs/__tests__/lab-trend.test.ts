import { describe, expect, it } from "vitest";

import { criticalTTwoSided } from "@/lib/insights/correlations";
import { computeLabTrend } from "../lab-trend";

const YEAR_MS = 365.25 * 86_400_000;
const T0 = Date.UTC(2023, 0, 1);
const atYears = (y: number) => new Date(T0 + y * YEAR_MS);
const readings = (values: Array<[number, number]>) =>
  values.map(([y, value]) => ({ takenAt: atYears(y), value }));

describe("criticalTTwoSided", () => {
  it("matches the tabled Student t at alpha 0.05", () => {
    // df 1: tan(0.95·π/2) exactly.
    expect(criticalTTwoSided(1)).toBeCloseTo(Math.tan(0.475 * Math.PI), 6);
    expect(criticalTTwoSided(2)).toBeCloseTo(4.302653, 5);
    expect(criticalTTwoSided(10)).toBeCloseTo(2.228139, 5);
    expect(criticalTTwoSided(1000)).toBeCloseTo(1.962339, 4);
    expect(criticalTTwoSided(0)).toBeNull();
  });
});

describe("computeLabTrend", () => {
  it("needs three readings over at least a year", () => {
    expect(
      computeLabTrend(
        readings([
          [0, 1],
          [2, 2],
        ]),
        { low: 0, high: 5 },
        atYears(2),
      ),
    ).toEqual({
      status: "insufficient",
      reason: "too_few_values",
      n: 2,
      spanDays: 731,
    });
    expect(
      computeLabTrend(
        readings([
          [0, 1],
          [0.3, 2],
          [0.6, 3],
        ]),
        { low: 0, high: 5 },
        atYears(1),
      ),
    ).toMatchObject({ status: "insufficient", reason: "span_too_short", n: 3 });
  });

  it("projects the exit date of an exact line", () => {
    // 100, 110, 120 a year apart: 10 per year, no residual, band top 140.
    const trend = computeLabTrend(
      readings([
        [0, 100],
        [1, 110],
        [2, 120],
      ]),
      { low: 70, high: 140 },
      atYears(2),
    );
    expect(trend).toMatchObject({
      status: "ok",
      n: 3,
      slopePerYear: 10,
      slopeCi95: [10, 10],
      pValue: 0,
      fittedNow: 120,
      projection: "exits",
      exitBound: "high",
      // The line meets 140 four years after the first reading.
      exitDate: new Date(T0 + 4 * YEAR_MS).toISOString().slice(0, 10),
    });
  });

  it("draws no projection when the slope's interval includes zero", () => {
    // 100, 112, 118: slope 9, SSR 6, df 1, SE √3, t = 9/√3.
    const trend = computeLabTrend(
      readings([
        [0, 100],
        [1, 112],
        [2, 118],
      ]),
      { low: 70, high: 140 },
      atYears(2),
    );
    if (trend.status !== "ok") throw new Error("expected ok");
    const half = Math.tan(0.475 * Math.PI) * Math.sqrt(3);
    expect(trend.slopePerYear).toBe(9);
    expect(trend.slopeCi95[0]).toBeCloseTo(9 - half, 3);
    expect(trend.slopeCi95[1]).toBeCloseTo(9 + half, 3);
    // df 1 is the Cauchy: p = (2/π)·atan(√3 / 9).
    expect(trend.pValue).toBeCloseTo(
      (2 / Math.PI) * Math.atan(Math.sqrt(3) / 9),
      5,
    );
    expect(trend.projection).toBe("no_clear_trend");
    expect(trend.exitDate).toBeNull();
  });

  it("says when the line is already outside, has no band, or exits too late", () => {
    const line = readings([
      [0, 100],
      [1, 110],
      [2, 120],
    ]);
    expect(
      computeLabTrend(line, { low: 70, high: 115 }, atYears(2)),
    ).toMatchObject({ projection: "already_outside" });
    expect(
      computeLabTrend(line, { low: null, high: null }, atYears(2)),
    ).toMatchObject({ projection: "no_band" });
    expect(
      computeLabTrend(line, { low: 70, high: 200 }, atYears(2)),
    ).toMatchObject({ projection: "beyond_horizon", exitDate: null });
    // Falling toward a band with no lower bound.
    const falling = readings([
      [0, 120],
      [1, 110],
      [2, 100],
    ]);
    expect(
      computeLabTrend(falling, { low: null, high: 140 }, atYears(2)),
    ).toMatchObject({ projection: "no_exit" });
    expect(
      computeLabTrend(falling, { low: 90, high: 140 }, atYears(2)),
    ).toMatchObject({ projection: "exits", exitBound: "low" });
  });
});
