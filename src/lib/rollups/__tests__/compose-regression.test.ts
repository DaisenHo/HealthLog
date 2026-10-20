/**
 * v1.20.0 — `composeRegression` closed-form parity (container-free).
 *
 * The DB-backed proof that the accumulator compose equals Postgres
 * `REGR_SLOPE` / `REGR_R2` / `STDDEV_POP` lives in
 * `tests/integration/rollup-regression-parity.integration.test.ts`. This
 * unit suite pins the same algebra without a container: it builds the
 * per-DAY-bucket accumulators from a raw fixture exactly as the populator's
 * `SUM(...)` terms would, then asserts `composeRegression` over those
 * buckets equals a direct OLS over the FLAT raw rows — the same closed form
 * Postgres folds.
 *
 * Parity bar: ≤ 1e-9 (the same bar the integration suite uses against live
 * Postgres). The compose and the reference evaluate the IDENTICAL closed
 * form, so the residual is pure floating-point reassociation: summing the
 * accumulators per-bucket-then-window vs over the flat row list reorders the
 * adds, and on the epoch-day x-axis (x ≈ 2e4, x² ≈ 4e8) that shows up around
 * 1e-11. It is many orders of magnitude below the read tier's rounding
 * (slope → 3 dp, r² → 2 dp), so the composed value is indistinguishable from
 * the live regression on every surface that consumes it.
 *
 * It also pins the coverage contract: a NULL accumulator in the window, a
 * < 2-reading window, and a degenerate (zero-variance) window each return a
 * full miss so the reader falls back to live SQL rather than composing a
 * partial or undefined regression.
 */
import { describe, expect, it } from "vitest";

import {
  composeRegression,
  hasPendingAccumulatorBackfill,
  type AccumulatorBucketRow,
  type RegressionAccumulators,
} from "../measurement-read";

/** A raw reading: its UTC instant and value. x is epoch-days. */
interface Raw {
  at: string;
  value: number;
}

/** Epoch-days for an ISO instant — the populator's x-axis. */
function epochDays(at: string): number {
  return new Date(at).getTime() / 86_400_000;
}

/**
 * Direct OLS over the FLAT raw rows — the reference closed form. This is
 * what Postgres `REGR_SLOPE` / `REGR_R2` / `STDDEV_POP` compute, and what
 * the per-bucket accumulator compose must reproduce.
 */
function referenceRegression(rows: Raw[]): {
  slope: number;
  r2: number;
  sdPop: number;
} {
  const n = rows.length;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const r of rows) {
    const x = epochDays(r.at);
    sx += x;
    sy += r.value;
    sxy += x * r.value;
    sxx += x * x;
    syy += r.value * r.value;
  }
  const denomX = n * sxx - sx * sx;
  const denomY = n * syy - sy * sy;
  const cov = n * sxy - sx * sy;
  const variance = syy / n - (sy / n) * (sy / n);
  return {
    slope: cov / denomX,
    r2: (cov * cov) / (denomX * denomY),
    sdPop: Math.sqrt(variance <= 0 ? 0 : variance),
  };
}

/**
 * Fold raw rows into per-DAY-bucket accumulators exactly as the populator's
 * `GROUP BY date_trunc('day', …)` + `SUM(...)` terms do.
 */
function dayBucketAccumulators(rows: Raw[]): RegressionAccumulators[] {
  const byDay = new Map<string, Raw[]>();
  for (const r of rows) {
    const day = r.at.slice(0, 10);
    const list = byDay.get(day);
    if (list) list.push(r);
    else byDay.set(day, [r]);
  }
  return [...byDay.values()].map((dayRows) => {
    let count = 0;
    let sy = 0;
    let sx = 0;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const r of dayRows) {
      const x = epochDays(r.at);
      count += 1;
      sy += r.value;
      sx += x;
      sxy += x * r.value;
      sxx += x * x;
      syy += r.value * r.value;
    }
    return {
      count,
      mean: sy / count,
      sumX: sx,
      sumXy: sxy,
      sumXx: sxx,
      sumYy: syy,
    };
  });
}

describe("composeRegression — closed-form parity", () => {
  it("equals the flat OLS over raw rows for an uneven multi-bucket fixture", () => {
    // Uneven per-day counts across several days — the regime where folding
    // matters. Non-collinear values so slope / r² / sd are all well-defined.
    const raw: Raw[] = [
      { at: "2026-03-02T08:00:00.000Z", value: 90.0 },
      { at: "2026-03-03T07:00:00.000Z", value: 89.4 },
      { at: "2026-03-03T20:00:00.000Z", value: 89.9 },
      { at: "2026-03-09T06:00:00.000Z", value: 88.7 },
      { at: "2026-03-09T09:00:00.000Z", value: 89.1 },
      { at: "2026-03-09T21:00:00.000Z", value: 88.2 },
      { at: "2026-03-21T08:00:00.000Z", value: 87.6 },
      { at: "2026-04-04T07:00:00.000Z", value: 86.9 },
      { at: "2026-04-04T19:00:00.000Z", value: 87.3 },
      { at: "2026-05-02T08:00:00.000Z", value: 85.4 },
      { at: "2026-05-16T08:00:00.000Z", value: 84.8 },
    ];

    const reference = referenceRegression(raw);
    const composed = composeRegression(dayBucketAccumulators(raw));

    expect(composed.slope).not.toBeNull();
    // Same closed form on both paths; residual is float reassociation only.
    expect(composed.slope!).toBeCloseTo(reference.slope, 9);
    expect(composed.r2!).toBeCloseTo(reference.r2, 9);
    expect(composed.sdPop!).toBeCloseTo(reference.sdPop, 9);
  });

  it("guards the guard: the fixture is non-trivial (slope ≠ 0, r² ∈ (0,1))", () => {
    const raw: Raw[] = [
      { at: "2026-03-02T08:00:00.000Z", value: 90.0 },
      { at: "2026-03-03T07:00:00.000Z", value: 89.4 },
      { at: "2026-03-09T06:00:00.000Z", value: 88.7 },
      { at: "2026-04-04T07:00:00.000Z", value: 86.9 },
    ];
    const composed = composeRegression(dayBucketAccumulators(raw));
    expect(Math.abs(composed.slope!)).toBeGreaterThan(1e-6);
    expect(composed.r2!).toBeGreaterThan(0);
    expect(composed.r2!).toBeLessThan(1);
  });

  it("returns a full miss when any in-window bucket lacks accumulators", () => {
    const acc: RegressionAccumulators[] = [
      { count: 2, mean: 90, sumX: 1, sumXy: 2, sumXx: 3, sumYy: 4 },
      // Pre-migration row — accumulators NULL.
      { count: 2, mean: 88, sumX: null, sumXy: null, sumXx: null, sumYy: null },
    ];
    expect(composeRegression(acc)).toEqual({
      slope: null,
      r2: null,
      sdPop: null,
    });
  });

  it("returns a full miss for a single-reading window (< 2 points)", () => {
    const x = epochDays("2026-05-01T08:00:00.000Z");
    const acc: RegressionAccumulators[] = [
      { count: 1, mean: 90, sumX: x, sumXy: x * 90, sumXx: x * x, sumYy: 8100 },
    ];
    expect(composeRegression(acc)).toEqual({
      slope: null,
      r2: null,
      sdPop: null,
    });
  });

  it("slope is null but sd is defined when all readings share one instant (no x-variance)", () => {
    // Two readings at the SAME x (same instant) with different values: x has
    // no variance (slope/r² undefined → null) but y does (sd defined).
    const x = epochDays("2026-05-01T08:00:00.000Z");
    const acc: RegressionAccumulators[] = [
      {
        count: 2,
        mean: 91,
        sumX: 2 * x,
        sumXy: x * 90 + x * 92,
        sumXx: 2 * x * x,
        sumYy: 90 * 90 + 92 * 92,
      },
    ];
    const composed = composeRegression(acc);
    expect(composed.slope).toBeNull();
    expect(composed.r2).toBeNull();
    expect(composed.sdPop!).toBeCloseTo(1, 12); // values 90, 92 → pop sd = 1
  });
});

describe("hasPendingAccumulatorBackfill — observable miss signal", () => {
  const day = (iso: string): Date => new Date(iso);
  const full = (bucketStart: Date): AccumulatorBucketRow => ({
    bucketStart,
    count: 2,
    mean: 90,
    sumX: 1,
    sumXy: 2,
    sumXx: 3,
    sumYy: 4,
  });
  const nullAcc = (bucketStart: Date): AccumulatorBucketRow => ({
    bucketStart,
    count: 2,
    mean: 88,
    sumX: null,
    sumXy: null,
    sumXx: null,
    sumYy: null,
  });
  const since = day("2026-03-01T00:00:00.000Z");

  it("is true when an in-window bucket carries a NULL accumulator", () => {
    const rows = [
      full(day("2026-03-02T00:00:00.000Z")),
      nullAcc(day("2026-03-10T00:00:00.000Z")),
    ];
    expect(hasPendingAccumulatorBackfill(rows, since)).toBe(true);
  });

  it("is false when every in-window bucket has full accumulators", () => {
    const rows = [
      full(day("2026-03-02T00:00:00.000Z")),
      full(day("2026-03-10T00:00:00.000Z")),
    ];
    expect(hasPendingAccumulatorBackfill(rows, since)).toBe(false);
  });

  it("ignores a NULL accumulator that falls before the window cutoff", () => {
    const rows = [
      // Pre-window NULL row — outside the regression window, must not flag.
      nullAcc(day("2026-02-20T00:00:00.000Z")),
      full(day("2026-03-10T00:00:00.000Z")),
    ];
    expect(hasPendingAccumulatorBackfill(rows, since)).toBe(false);
  });

  it("is false for an empty bucket set", () => {
    expect(hasPendingAccumulatorBackfill([], since)).toBe(false);
  });
});
