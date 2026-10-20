import { describe, expect, it } from "vitest";

import { fitFromSums, linearFit, sumsOf, trendLineByTime } from "../linear-fit";

describe("linearFit", () => {
  it("fits an exact line", () => {
    const fit = linearFit([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
  });

  it("answers null without a slope, and a null r² without y variance", () => {
    expect(linearFit([1], [1])).toBeNull();
    expect(linearFit([2, 2, 2], [1, 2, 3])).toBeNull();
    expect(linearFit([0, 1, 2], [5, 5, 5])!.r2).toBeNull();
  });

  it("keeps its digits on an epoch-day axis", () => {
    const xs = [20_000, 20_001, 20_002, 20_003].map((d) => d * 86_400);
    const fit = linearFit(xs, [10, 11, 12, 13])!;
    expect(fit.slope * 86_400).toBeCloseTo(1, 6);
  });

  it("fits the same from points and from their sums", () => {
    const xs = [0, 2, 3, 7, 9];
    const ys = [4, 5, 5, 9, 11];
    expect(fitFromSums(sumsOf(xs, ys))).toEqual(linearFit(xs, ys));
  });
});

describe("trendLineByTime", () => {
  it("draws the fitted value at two decimals per point, in time order", () => {
    const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));
    const line = trendLineByTime([
      { date: day(2), value: 3 },
      { date: day(0), value: 1 },
      { date: day(1), value: 2.5 },
    ])!;
    expect(line.points.map((p) => p.date)).toEqual([day(0), day(1), day(2)]);
    expect(line.slopePerDay).toBeCloseTo(1, 12);
    expect(line.points.map((p) => p.value)).toEqual([1.17, 2.17, 3.17]);
  });
});
