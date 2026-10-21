/**
 * v1.44 — the slope of one lab marker over all its readings, and where that
 * line would leave the reference band.
 *
 * A single panel says where a value is; the trend says where it is going.
 * The statistic is an ordinary least-squares line through every numeric
 * reading of the marker (stored in the marker's unit since v1.40, so the
 * series is unit-normalised by construction), x in years. It is reported
 * only with at least {@link LAB_TREND_MIN_VALUES} readings spanning at least
 * {@link LAB_TREND_MIN_SPAN_DAYS} days: three draws in one month are a
 * measurement-noise question, not a trend.
 *
 * The slope carries its 95 % confidence interval (Student t at n − 2 degrees
 * of freedom). A projection is offered only when that interval excludes zero,
 * the line is inside the band today and heads toward a bound it reaches
 * within the horizon: {@link LAB_PROJECTION_HORIZON_YEARS} years, or the span
 * the readings cover when that is shorter, so the line is never carried
 * further ahead than the data reaches back.
 *
 * A marker whose newest reading is older than {@link LAB_TREND_STALE_DAYS}
 * days gets no projection at all (`stale`): the line is evaluated on the day
 * of that reading and reported as of then, with no exit date and no
 * "already outside" verdict about a today the readings say nothing about. It is a straight-line
 * extrapolation, labelled as one wherever it is shown, never a forecast of
 * the body and never a risk statement: lab values plateau, respond to
 * treatment and carry assay noise a line does not know about. With three
 * readings the interval is wide (t ≈ 12.7 at one degree of freedom), so the
 * projection is rare exactly where the evidence is thin.
 *
 * Pure. The read lives in the biomarker route.
 */
import { criticalTTwoSided, twoSidedPFromT } from "@/lib/insights/correlations";
import { linearFit } from "@/lib/stats/linear-fit";
import { dateOnlyKey } from "@/lib/tz/date-only";

export const LAB_TREND_MIN_VALUES = 3;
export const LAB_TREND_MIN_SPAN_DAYS = 365;
export const LAB_PROJECTION_HORIZON_YEARS = 3;
/** Newest reading older than this: the trend is reported as of that reading. */
export const LAB_TREND_STALE_DAYS = 365;

const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;

export type LabTrendProjection =
  /** The line meets a bound within the horizon: `exitDate` is set. */
  | "exits"
  /** The line heads to a bound but meets it after the horizon. */
  | "beyond_horizon"
  /** The line heads away from the band edges, or to a side with no bound. */
  | "no_exit"
  /** The line already sits outside the band today. */
  | "already_outside"
  /** The slope's interval includes zero: no projection is drawn. */
  | "no_clear_trend"
  /** The marker has no reference band to leave. */
  | "no_band"
  /**
   * The newest reading is older than {@link LAB_TREND_STALE_DAYS} days: the
   * line is reported as of that reading (`asOf` = `lastAt`), not projected.
   */
  | "stale";

export interface LabTrendOk {
  status: "ok";
  /** Readings in the fit. */
  n: number;
  firstAt: string;
  lastAt: string;
  spanDays: number;
  /** Change per year in the marker's unit. */
  slopePerYear: number;
  /** 95 % interval of the slope per year. */
  slopeCi95: [number, number];
  /** Two-sided p of the slope against zero (t at n − 2 df). */
  pValue: number;
  /** The line's value on `asOf`. */
  fittedNow: number;
  /** Today, or the newest reading's day when the trend is `stale`. */
  asOf: string;
  /**
   * How far ahead a bound may be met and still count as `exits`: three years,
   * or the readings' span when shorter.
   */
  horizonYears: number;
  /**
   * True when `horizonYears` is the three-year cap, false when the readings'
   * shorter span set it.
   */
  horizonCapped: boolean;
  projection: LabTrendProjection;
  /** Set only for `exits`: the day the line meets `exitBound`. */
  exitDate: string | null;
  exitBound: "low" | "high" | null;
}

export interface LabTrendInsufficient {
  status: "insufficient";
  reason: "too_few_values" | "span_too_short";
  n: number;
  spanDays: number;
}

export type LabTrend = LabTrendOk | LabTrendInsufficient;

const round = (x: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
};

/**
 * The calendar label of a draw instant. Lab readings carry the day of the
 * draw as their meaning (`reading-day.ts`); the exit day is a point on the
 * same axis, so both read through the same label.
 */
const dayOf = (ms: number) => dateOnlyKey(new Date(ms));

/**
 * Fit the marker's readings and place the line against its band.
 * `now` anchors "today" for the fitted value and the horizon.
 */
export function computeLabTrend(
  readings: ReadonlyArray<{ takenAt: Date; value: number }>,
  band: { low: number | null; high: number | null },
  now: Date,
): LabTrend {
  const points = readings
    .filter((r) => Number.isFinite(r.value))
    .map((r) => ({ t: r.takenAt.getTime(), v: r.value }))
    .sort((a, b) => a.t - b.t);
  const n = points.length;
  const spanDays =
    n > 0 ? Math.round((points[n - 1].t - points[0].t) / DAY_MS) : 0;
  if (n < LAB_TREND_MIN_VALUES) {
    return { status: "insufficient", reason: "too_few_values", n, spanDays };
  }
  if (spanDays < LAB_TREND_MIN_SPAN_DAYS) {
    return { status: "insufficient", reason: "span_too_short", n, spanDays };
  }

  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / DAY_MS / YEAR_DAYS);
  const ys = points.map((p) => p.v);
  const fit = linearFit(xs, ys);
  if (!fit) {
    return { status: "insufficient", reason: "span_too_short", n, spanDays };
  }

  const df = n - 2;
  // Residual variance from the centred sums: SSR = Syy − Sxy² / Sxx.
  const ssr = Math.max(0, fit.syy - (fit.sxy * fit.sxy) / fit.sxx);
  const se = df > 0 ? Math.sqrt(ssr / df / fit.sxx) : Infinity;
  const tCrit = criticalTTwoSided(df) ?? Infinity;
  const half = tCrit * se;
  const lo = fit.slope - half;
  const hi = fit.slope + half;
  const pValue =
    se === 0
      ? fit.slope === 0
        ? 1
        : 0
      : twoSidedPFromT(Math.abs(fit.slope / se), df);

  const tLast = points[n - 1].t;
  const stale = now.getTime() - tLast > LAB_TREND_STALE_DAYS * DAY_MS;
  // A stale series is read on its own last day, never carried to today.
  const tAsOf = stale ? tLast : now.getTime();
  const xNow = (tAsOf - t0) / DAY_MS / YEAR_DAYS;
  const fittedNow = fit.intercept + fit.slope * xNow;
  const spanYears = (tLast - t0) / DAY_MS / YEAR_DAYS;
  const horizonCapped = spanYears >= LAB_PROJECTION_HORIZON_YEARS;
  const horizonYears = Math.min(LAB_PROJECTION_HORIZON_YEARS, spanYears);

  let projection: LabTrendProjection;
  let exitDate: string | null = null;
  let exitBound: "low" | "high" | null = null;
  const hasBand = band.low != null || band.high != null;
  if (stale) projection = "stale";
  else if (!hasBand) projection = "no_band";
  else if (!(lo > 0 || hi < 0)) projection = "no_clear_trend";
  else if (
    (band.low != null && fittedNow < band.low) ||
    (band.high != null && fittedNow > band.high)
  ) {
    projection = "already_outside";
  } else {
    const bound = fit.slope > 0 ? band.high : band.low;
    if (bound == null) projection = "no_exit";
    else {
      const xCross = (bound - fit.intercept) / fit.slope;
      const yearsAhead = xCross - xNow;
      if (yearsAhead > horizonYears) {
        projection = "beyond_horizon";
      } else {
        projection = "exits";
        exitBound = fit.slope > 0 ? "high" : "low";
        exitDate = dayOf(t0 + xCross * YEAR_DAYS * DAY_MS);
      }
    }
  }

  return {
    status: "ok",
    n,
    firstAt: dayOf(points[0].t),
    lastAt: dayOf(points[n - 1].t),
    spanDays,
    slopePerYear: round(fit.slope, 4),
    slopeCi95: [round(lo, 4), round(hi, 4)],
    pValue: round(pValue, 6),
    fittedNow: round(fittedNow, 4),
    asOf: dayOf(tAsOf),
    horizonYears: round(horizonYears, 2),
    horizonCapped,
    projection,
    exitDate,
    exitBound,
  };
}
