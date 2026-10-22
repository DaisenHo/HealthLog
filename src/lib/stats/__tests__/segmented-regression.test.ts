/**
 * Exact statistics for the segmented (interrupted time series) regression.
 *
 * The reference values for the noisy fixtures were computed independently
 * with statsmodels 0.14.4 (`OLS(...).fit(cov_type="HAC", cov_kwds={"maxlags":
 * L, "use_correction": True}, use_t=True)`) and scipy's `stats.t`, at the
 * default lag L = max(7, floor(4·(n/100)^(2/9))) = 7 and, to pin the HAC meat
 * at a second lag, at the automatic L = 3 passed explicitly. To recompute:
 * build the fixture below in Python (Python's floored `%`), fit the design
 * [1, t, D, t·D] with the call above at each L, and read `params`, `bse` and
 * `conf_int(0.05)`; the coefficients and R² do not depend on L. The fixture generator below is the same deterministic
 * formula the reference script used, so a drift in the estimator, the HAC
 * meat, the small-sample factor or the t quantile fails here.
 */
import { describe, expect, it } from "vitest";

import {
  defaultHacLag,
  fitSegmentedRegression,
  MIN_HAC_LAG,
  neweyWestLag,
  studentTCdf,
  studentTQuantile,
  type SegmentedPoint,
} from "@/lib/stats/segmented-regression";

/** y = 140 − 0.05·t − 8·D − 0.1·t·D + deterministic wobble. */
function fixture(
  nPre: number,
  nPost: number,
  opts: { gaps?: boolean; noise?: boolean } = {},
): SegmentedPoint[] {
  const out: SegmentedPoint[] = [];
  for (let t = -nPre; t < nPost; t++) {
    if (opts.gaps && ((t % 5) + 5) % 5 === 2) continue;
    // Python's `%` is a floored modulo; JS `%` truncates. Match Python.
    const pyMod = (((0.45 * t * t) % 7) + 7) % 7;
    const noise =
      opts.noise === false ? 0 : 3 * Math.sin(1.7 * t) + 2 * Math.cos(pyMod);
    const d = t >= 0 ? 1 : 0;
    out.push({ t, y: 140 - 0.05 * t - 8 * d - 0.1 * t * d + noise });
  }
  return out;
}

describe("studentT", () => {
  it("matches scipy quantiles", () => {
    expect(studentTQuantile(0.975, 10)).toBeCloseTo(2.228138851986274, 9);
    expect(studentTQuantile(0.975, 86)).toBeCloseTo(1.98793420623902, 9);
    expect(studentTQuantile(0.95, 3)).toBeCloseTo(2.3533634348018233, 9);
  });

  it("matches the scipy CDF", () => {
    expect(studentTCdf(-2.1, 7)).toBeCloseTo(0.036935598106461326, 10);
    expect(studentTCdf(0, 5)).toBeCloseTo(0.5, 12);
  });
});

describe("fitSegmentedRegression", () => {
  it("recovers a noise-free level and slope change exactly, with zero-width intervals", () => {
    const fit = fitSegmentedRegression(fixture(30, 30, { noise: false }));
    expect(fit).not.toBeNull();
    expect(fit!.intercept.estimate).toBeCloseTo(140, 9);
    expect(fit!.preSlope.estimate).toBeCloseTo(-0.05, 9);
    expect(fit!.levelChange.estimate).toBeCloseTo(-8, 9);
    expect(fit!.slopeChange.estimate).toBeCloseTo(-0.1, 9);
    expect(fit!.levelChange.standardError).toBeLessThan(1e-9);
    expect(fit!.rSquared).toBeCloseTo(1, 12);
  });

  it("matches statsmodels HAC on a contiguous 90-day series at the default lag", () => {
    const fit = fitSegmentedRegression(fixture(40, 50))!;
    expect(fit.n).toBe(90);
    expect(fit.df).toBe(86);
    expect(fit.hacLag).toBe(7);
    expect(fit.levelChange.estimate).toBeCloseTo(-7.336815685253282, 9);
    expect(fit.intercept.standardError).toBeCloseTo(0.3926378134611552, 9);
    expect(fit.preSlope.standardError).toBeCloseTo(0.015434960504949637, 10);
    expect(fit.levelChange.standardError).toBeCloseTo(0.5544100003043471, 9);
    expect(fit.slopeChange.standardError).toBeCloseTo(0.02119259135971675, 10);
    expect(fit.levelChange.ciLow).toBeCloseTo(-8.43894628913928, 8);
    expect(fit.levelChange.ciHigh).toBeCloseTo(-6.234685081367285, 8);
    expect(fit.slopeChange.ciLow).toBeCloseTo(-0.07897452738576954, 9);
    expect(fit.slopeChange.ciHigh).toBeCloseTo(0.005284427179883318, 9);
    expect(fit.rSquared).toBeCloseTo(0.8683372493940129, 10);
  });

  it("matches statsmodels HAC on a contiguous 90-day series at lag 3", () => {
    const fit = fitSegmentedRegression(fixture(40, 50), { hacLag: 3 })!;
    expect(fit.n).toBe(90);
    expect(fit.df).toBe(86);
    expect(fit.hacLag).toBe(3);
    expect(fit.intercept.estimate).toBeCloseTo(139.46950523140714, 9);
    expect(fit.preSlope.estimate).toBeCloseTo(-0.09725785860840647, 10);
    expect(fit.levelChange.estimate).toBeCloseTo(-7.336815685253282, 9);
    expect(fit.slopeChange.estimate).toBeCloseTo(-0.03684505010294312, 10);
    expect(fit.intercept.standardError).toBeCloseTo(0.3824128525477469, 9);
    expect(fit.preSlope.standardError).toBeCloseTo(0.018189958785228614, 10);
    expect(fit.levelChange.standardError).toBeCloseTo(0.5960977099276101, 9);
    expect(fit.slopeChange.standardError).toBeCloseTo(0.02336733639963861, 10);
    expect(fit.levelChange.ciLow).toBeCloseTo(-8.521818713079124, 8);
    expect(fit.levelChange.ciHigh).toBeCloseTo(-6.151812657427441, 8);
    expect(fit.slopeChange.ciLow).toBeCloseTo(-0.08329777744047885, 9);
    expect(fit.slopeChange.ciHigh).toBeCloseTo(0.009607677234592618, 9);
    expect(fit.rSquared).toBeCloseTo(0.8683372493940129, 10);
  });

  it("matches statsmodels HAC on a series with gaps at the default lag", () => {
    const fit = fitSegmentedRegression(fixture(30, 30, { gaps: true }))!;
    expect(fit.n).toBe(48);
    expect(fit.hacLag).toBe(7);
    expect(fit.levelChange.estimate).toBeCloseTo(-6.123258149435133, 9);
    expect(fit.levelChange.standardError).toBeCloseTo(0.7919225818543464, 9);
    expect(fit.levelChange.ciLow).toBeCloseTo(-7.71927324237417, 8);
    expect(fit.levelChange.ciHigh).toBeCloseTo(-4.527243056496095, 8);
    expect(fit.slopeChange.estimate).toBeCloseTo(-0.11857109294626766, 10);
    expect(fit.slopeChange.ciLow).toBeCloseTo(-0.22143394263874167, 9);
    expect(fit.slopeChange.ciHigh).toBeCloseTo(-0.01570824325379365, 9);
  });

  it("matches statsmodels HAC on a series with gaps at lag 3", () => {
    const fit = fitSegmentedRegression(fixture(30, 30, { gaps: true }), {
      hacLag: 3,
    })!;
    expect(fit.n).toBe(48);
    expect(fit.hacLag).toBe(3);
    expect(fit.levelChange.estimate).toBeCloseTo(-6.123258149435133, 9);
    expect(fit.levelChange.standardError).toBeCloseTo(0.9608527406825199, 9);
    expect(fit.levelChange.ciLow).toBeCloseTo(-8.059729606822106, 8);
    expect(fit.levelChange.ciHigh).toBeCloseTo(-4.18678669204816, 8);
    expect(fit.slopeChange.estimate).toBeCloseTo(-0.11857109294626766, 10);
    expect(fit.slopeChange.ciLow).toBeCloseTo(-0.23733292721328714, 9);
    expect(fit.slopeChange.ciHigh).toBeCloseTo(0.0001907413207517944, 9);
    expect(fit.rSquared).toBeCloseTo(0.8247246446176286, 10);
  });

  it("returns null when one side of the change has no points", () => {
    expect(
      fitSegmentedRegression(fixture(0, 30).filter((p) => p.t >= 0)),
    ).toBeNull();
  });

  it("returns null without residual degrees of freedom", () => {
    expect(fitSegmentedRegression(fixture(2, 2, { noise: false }))).toBeNull();
  });

  it("uses the automatic Newey–West lag, never below a week", () => {
    expect(neweyWestLag(90)).toBe(3);
    expect(neweyWestLag(30)).toBe(3);
    expect(neweyWestLag(10)).toBe(2);
    expect(MIN_HAC_LAG).toBe(7);
    expect(defaultHacLag(90)).toBe(7);
    expect(defaultHacLag(270)).toBe(7);
    expect(defaultHacLag(100_000)).toBe(neweyWestLag(100_000));
    // A short series clamps to n − 1.
    expect(fitSegmentedRegression(fixture(4, 4))!.hacLag).toBe(7);
    expect(fitSegmentedRegression(fixture(3, 3))!.hacLag).toBe(5);
  });
});
