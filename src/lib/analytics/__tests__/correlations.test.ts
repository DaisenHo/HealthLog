import { describe, it, expect } from "vitest";
import type { DataPoint } from "../trends";
import {
  pairByTimestamp,
  significantPearsonCorrelation,
} from "../correlations";
import type { PairedPoint } from "../correlations";

function makePoints(values: number[], startDaysAgo = 30): DataPoint[] {
  const now = Date.now();
  return values.map((value, i) => ({
    date: new Date(now - (startDaysAgo - i) * 24 * 60 * 60 * 1000),
    value,
  }));
}

describe("pairByTimestamp", () => {
  it("returns empty for empty input", () => {
    expect(pairByTimestamp([], [], 86400000)).toEqual([]);
    expect(pairByTimestamp(makePoints([1]), [], 86400000)).toEqual([]);
  });

  it("pairs points within the gap", () => {
    const a = makePoints([70, 71, 72], 3);
    const b = makePoints([120, 130, 140], 3);
    const pairs = pairByTimestamp(a, b);
    expect(pairs).toHaveLength(3);
    expect(pairs[0].a).toBe(70);
    expect(pairs[0].b).toBe(120);
  });

  it("does not pair points beyond maxGap", () => {
    const now = Date.now();
    const a: DataPoint[] = [{ date: new Date(now), value: 70 }];
    const b: DataPoint[] = [
      { date: new Date(now - 3 * 24 * 60 * 60 * 1000), value: 120 },
    ];
    const pairs = pairByTimestamp(a, b, 24 * 60 * 60 * 1000);
    expect(pairs).toHaveLength(0);
  });

  it("uses each point at most once", () => {
    const now = Date.now();
    const a: DataPoint[] = [
      { date: new Date(now), value: 70 },
      { date: new Date(now + 1000), value: 71 },
    ];
    const b: DataPoint[] = [{ date: new Date(now), value: 120 }];
    const pairs = pairByTimestamp(a, b);
    expect(pairs).toHaveLength(1);
  });
});

describe("significantPearsonCorrelation (M-CS3 — n>=20 AND p<0.05)", () => {
  const mk = (a: number, b: number): PairedPoint => ({
    a,
    b,
    date: new Date(),
  });

  it("suppresses a 5-pair r≈0.7 dataset (below the n>=20 floor)", () => {
    // Five points with a strong-looking slope: the small-n fluke an
    // ungated band would call a "stark" correlation.
    const pairs = [mk(1, 1), mk(2, 2), mk(3, 2), mk(4, 4), mk(5, 3)];
    expect(significantPearsonCorrelation(pairs)).toBeNull();
  });

  it("surfaces a >=20-pair significant dataset", () => {
    // 20 points on a near-perfect line → high r, vanishingly small p.
    const pairs = Array.from({ length: 20 }, (_, i) =>
      mk(i, i * 2 + (i % 2 === 0 ? 0.3 : -0.3)),
    );
    const result = significantPearsonCorrelation(pairs);
    expect(result).not.toBeNull();
    expect(result!.n).toBe(20);
    expect(result!.strength).toBe("stark");
    expect(result!.r).toBeGreaterThan(0.9);
  });

  it("suppresses a 20-pair NON-significant (noisy) dataset", () => {
    // 20 points with no real relationship → p well above 0.05.
    const ys = [5, 2, 7, 1, 6, 3, 8, 2, 5, 4, 6, 1, 7, 3, 5, 2, 6, 4, 5, 3];
    const pairs = ys.map((y, i) => mk(i, y));
    expect(significantPearsonCorrelation(pairs)).toBeNull();
  });
});
