/**
 * Segmented regression for an interrupted time series.
 *
 * One change point, known in advance (a medication start), four parameters:
 *
 *   y(t) = b0 + b1·t + b2·D(t) + b3·t·D(t) + e(t)
 *
 * where `t` is the time in days relative to the change point and `D(t)` is 1
 * at and after it, 0 before. `b1` is the trend before the change, `b2` the
 * immediate shift in level, `b3` the change in slope. Fitted by ordinary
 * least squares.
 *
 * Daily health series are autocorrelated: today's blood pressure says a lot
 * about tomorrow's. Plain OLS standard errors ignore that and come out too
 * narrow, so the covariance here is the Newey–West estimator (Bartlett
 * kernel) and the small-sample factor n/(n−k). The lag is the usual automatic
 * `floor(4·(n/100)^(2/9))`, but never below {@link MIN_HAC_LAG}: on 30 to 270
 * daily values the automatic rule gives 3, while a physiological series
 * carries over for about a week (weight, resting heart rate, blood pressure
 * under a new medication), and three lags leave most of that out. Intervals
 * use Student's t with n−k degrees of freedom. This matches `statsmodels` OLS
 * `cov_type="HAC"` with `use_correction=True` and `use_t=True` at the same
 * `maxlags`; the unit tests pin it to values computed there.
 *
 * Observations are taken in the order given, which for a daily series with
 * gaps treats a gap as adjacent days. That is a known approximation of the
 * lag structure, not of the coefficients.
 *
 * Pure. No I/O, no rounding: callers round for display.
 */

/** One observation: time in days relative to the change point, and a value. */
export interface SegmentedPoint {
  t: number;
  y: number;
}

/** A coefficient with its HAC standard error and two-sided interval. */
export interface SegmentedEstimate {
  estimate: number;
  standardError: number;
  ciLow: number;
  ciHigh: number;
}

export interface SegmentedFit {
  /** Observations used. */
  n: number;
  /** Residual degrees of freedom, n − 4. */
  df: number;
  /** Confidence level of every interval, e.g. 0.95. */
  level: number;
  /** Newey–West truncation lag that was applied. */
  hacLag: number;
  intercept: SegmentedEstimate;
  preSlope: SegmentedEstimate;
  levelChange: SegmentedEstimate;
  slopeChange: SegmentedEstimate;
  /** Coefficient of determination of the fit. */
  rSquared: number;
  /** Lag-1 autocorrelation of the residuals (a reader's sanity check). */
  residualAutocorrelation: number;
}

const K = 4;

/** Smallest Newey–West lag applied: a week of daily carry-over. */
export const MIN_HAC_LAG = 7;

/** Automatic Newey–West lag: floor(4·(n/100)^(2/9)). */
export function neweyWestLag(n: number): number {
  return Math.floor(4 * Math.pow(n / 100, 2 / 9));
}

/** The lag applied by default: the automatic rule, at least {@link MIN_HAC_LAG}. */
export function defaultHacLag(n: number): number {
  return Math.max(MIN_HAC_LAG, neweyWestLag(n));
}

/** Invert a small symmetric positive-definite matrix (Gauss–Jordan). */
function invert(matrix: number[][]): number[][] | null {
  const size = matrix.length;
  const a = matrix.map((row, i) => [
    ...row,
    ...Array.from({ length: size }, (_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < size; col++) {
    let pivot = col;
    for (let r = col + 1; r < size; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const p = a[col][col];
    for (let j = 0; j < 2 * size; j++) a[col][j] /= p;
    for (let r = 0; r < size; r++) {
      if (r === col) continue;
      const f = a[r][col];
      if (f === 0) continue;
      for (let j = 0; j < 2 * size; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map((row) => row.slice(size));
}

function designRow(p: SegmentedPoint): number[] {
  const d = p.t >= 0 ? 1 : 0;
  return [1, p.t, d, p.t * d];
}

/**
 * Fit the four-parameter segmented model. Returns null when the design is
 * singular (no points on one side, or every point at one instant) or when
 * there are no residual degrees of freedom.
 */
export function fitSegmentedRegression(
  points: readonly SegmentedPoint[],
  options: { level?: number; hacLag?: number } = {},
): SegmentedFit | null {
  const level = options.level ?? 0.95;
  const n = points.length;
  const df = n - K;
  if (df < 1) return null;

  const X = points.map(designRow);
  const y = points.map((p) => p.y);

  const xtx = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  const xty = new Array<number>(K).fill(0);
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < K; r++) {
      xty[r] += X[i][r] * y[i];
      for (let c = 0; c < K; c++) xtx[r][c] += X[i][r] * X[i][c];
    }
  }
  const bread = invert(xtx);
  if (!bread) return null;
  const beta = bread.map((row) => row.reduce((s, v, c) => s + v * xty[c], 0));

  const residuals = y.map(
    (yi, i) => yi - X[i].reduce((s, v, c) => s + v * beta[c], 0),
  );

  // Meat: Σ e_t² x_t x_tᵀ + Σ_l w_l Σ_t e_t e_{t−l} (x_t x_{t−l}ᵀ + x_{t−l} x_tᵀ)
  const lag = Math.max(0, Math.min(options.hacLag ?? defaultHacLag(n), n - 1));
  const meat = Array.from({ length: K }, () => new Array<number>(K).fill(0));
  for (let l = 0; l <= lag; l++) {
    const w = l === 0 ? 1 : 1 - l / (lag + 1);
    for (let t = l; t < n; t++) {
      const ee = residuals[t] * residuals[t - l] * w;
      for (let r = 0; r < K; r++) {
        for (let c = 0; c < K; c++) {
          meat[r][c] +=
            l === 0
              ? ee * X[t][r] * X[t][c]
              : ee * (X[t][r] * X[t - l][c] + X[t - l][r] * X[t][c]);
        }
      }
    }
  }
  const correction = n / df;
  const cov = Array.from({ length: K }, (_, r) =>
    Array.from({ length: K }, (_, c) => {
      let s = 0;
      for (let i = 0; i < K; i++) {
        for (let j = 0; j < K; j++) s += bread[r][i] * meat[i][j] * bread[j][c];
      }
      return s * correction;
    }),
  );

  const tCrit = studentTQuantile(1 - (1 - level) / 2, df);
  const estimateAt = (i: number): SegmentedEstimate => {
    const se = Math.sqrt(Math.max(0, cov[i][i]));
    return {
      estimate: beta[i],
      standardError: se,
      ciLow: beta[i] - tCrit * se,
      ciHigh: beta[i] + tCrit * se,
    };
  };

  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    ssr += residuals[i] ** 2;
    sst += (y[i] - meanY) ** 2;
  }
  let acNum = 0;
  for (let i = 1; i < n; i++) acNum += residuals[i] * residuals[i - 1];

  return {
    n,
    df,
    level,
    hacLag: lag,
    intercept: estimateAt(0),
    preSlope: estimateAt(1),
    levelChange: estimateAt(2),
    slopeChange: estimateAt(3),
    rSquared: sst > 0 ? 1 - ssr / sst : 1,
    residualAutocorrelation: ssr > 0 ? acNum / ssr : 0,
  };
}

// ── Student's t ────────────────────────────────────────────────────────

/** ln Γ(x), Lanczos approximation (g = 7, n = 9). */
function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = c[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (z + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a)
  );
}

/** Continued fraction for the incomplete beta (Numerical Recipes betacf). */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const tiny = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return h;
}

/** Regularised incomplete beta I_x(a, b). */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(
    logGamma(a + b) -
      logGamma(a) -
      logGamma(b) +
      a * Math.log(x) +
      b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) {
    return (front * betaContinuedFraction(x, a, b)) / a;
  }
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** Student's t cumulative distribution function. */
export function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const tail = 0.5 * incompleteBeta(x, df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Student's t quantile, by bisection on the CDF (monotone, so it converges). */
export function studentTQuantile(p: number, df: number): number {
  if (p <= 0) return Number.NEGATIVE_INFINITY;
  if (p >= 1) return Number.POSITIVE_INFINITY;
  if (p === 0.5) return 0;
  let lo = -1e3;
  let hi = 1e3;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}
