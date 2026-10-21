/**
 * v1.22 — in-repo changepoint engine over DAY-bucket means.
 *
 * Replaces the vague "lately" with a dated, sustained LEVEL SHIFT:
 * "your resting heart rate stepped up around <date> and has held higher since".
 * This catches the clinically meaningful "changed-and-stayed" pattern a moving
 * trend line hides.
 *
 * The statistic is a single binary-segmentation / CUSUM-on-the-mean pass — no
 * PELT package, no new dependency (CONCEPT-3 §C1 prefers ~80 lines in-repo over
 * a vector/stats lib). We compute the cumulative deviation from the series mean,
 * take the index of maximum |CUSUM| as the candidate break, then VALIDATE the
 * split with a high firing bar so the detector never cries wolf on a spike:
 *
 *   - both segments must be long enough (a real regime, not an endpoint blip),
 *   - the post-break level must PERSIST (≥ `minPersistDays` after the break),
 *   - the level change must exceed the metric's own robust spread
 *     (|Δmean| ≥ `magnitudeK` · MAD · 1.4826), the personal yardstick, and
 *   - the series must be long enough overall.
 *
 * Below the bar the detector emits `null` and the Coach keeps saying "lately".
 * One changepoint per metric per window — no multi-break hunting in v1.22.
 *
 * The detector itself is PURE (`detectLevelShift` over `number[]`); the reader
 * (`buildChangepointSignals`) wraps it over the rollup tier for a small set of
 * stable metrics and maps the break index back to a calendar day.
 */
import type { MeasurementType } from "@/generated/prisma/client";
import { probeRollupCoverage } from "@/lib/rollups/measurement-coverage";
import { readDayMeanSeries } from "@/lib/insights/derived/baseline";
import { moduleForMeasurementType } from "@/lib/modules/measurement-scope";
import type { SurfaceModuleMap } from "@/lib/modules/surface";

const MAD_TO_SIGMA = 1.4826;

/** A validated level shift in a numeric series. */
export interface LevelShift {
  /** Index of the LAST point of the BEFORE segment (the break sits after it). */
  breakIndex: number;
  beforeMean: number;
  afterMean: number;
  /** Signed afterMean − beforeMean. */
  delta: number;
  /** |delta| expressed in robust-σ units (delta / (MAD·1.4826)). */
  magnitude: number;
  direction: "up" | "down";
}

export interface DetectLevelShiftOptions {
  /** Minimum total points before the detector will fire. Default 14. */
  minSeriesLength?: number;
  /** Minimum points in EACH segment. Default 5. */
  minSegmentLength?: number;
  /** Minimum points AFTER the break (persistence). Default 10. */
  minPersistDays?: number;
  /** |Δmean| floor in robust-σ units. Default 1.4 (high firing bar). */
  magnitudeK?: number;
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Robust spread: MAD·1.4826 (σ-equivalent). Zero when the series is flat. */
function robustSpread(xs: readonly number[]): number {
  const m = median(xs);
  const deviations = xs.map((x) => Math.abs(x - m));
  return median(deviations) * MAD_TO_SIGMA;
}

/**
 * Detect a single sustained level shift in a numeric series via CUSUM on the
 * mean + a two-segment validation against a high firing bar. Returns `null`
 * when nothing clears the bar (the common case — most series are flat or noisy,
 * not stepped).
 */
export function detectLevelShift(
  series: readonly number[],
  opts: DetectLevelShiftOptions = {},
): LevelShift | null {
  const minSeriesLength = opts.minSeriesLength ?? 14;
  const minSegmentLength = opts.minSegmentLength ?? 5;
  const minPersistDays = opts.minPersistDays ?? 10;
  const magnitudeK = opts.magnitudeK ?? 1.4;

  const n = series.length;
  if (n < minSeriesLength) return null;

  // CUSUM of deviations from the grand mean; the break candidate is the index
  // where the cumulative deviation is most extreme (the classic CUSUM peak).
  const grand = mean(series);
  let cusum = 0;
  let bestAbs = -1;
  let breakIndex = -1;
  for (let i = 0; i < n; i += 1) {
    cusum += series[i] - grand;
    const abs = Math.abs(cusum);
    if (abs > bestAbs) {
      bestAbs = abs;
      breakIndex = i;
    }
  }
  if (breakIndex < 0) return null;

  // Segment guards: both sides long enough + the after-side persists.
  const before = series.slice(0, breakIndex + 1);
  const after = series.slice(breakIndex + 1);
  if (
    before.length < minSegmentLength ||
    after.length < minSegmentLength ||
    after.length < minPersistDays
  ) {
    return null;
  }

  const beforeMean = mean(before);
  const afterMean = mean(after);
  const delta = afterMean - beforeMean;

  // Magnitude bar: the step must exceed the WITHIN-segment robust spread (the
  // metric's day-to-day noise), NOT the whole-series spread — a clean step
  // inflates the whole-series MAD and would mask itself. Pool conservatively
  // (the noisier segment). A genuinely clean step (both segments constant) has
  // pooled spread 0; a tiny epsilon lets a non-zero delta fire while a flat
  // series (delta 0) still yields magnitude 0 → null.
  const pooledSpread = Math.max(
    robustSpread(before),
    robustSpread(after),
    1e-9,
  );
  const magnitude = Math.abs(delta) / pooledSpread;
  if (magnitude < magnitudeK) return null;

  return {
    breakIndex,
    beforeMean,
    afterMean,
    delta,
    magnitude,
    direction: delta >= 0 ? "up" : "down",
  };
}

/** One detected changepoint, ready for the snapshot. */
export interface ChangepointSignal {
  metric: MeasurementType;
  /** YYYY-MM-DD of the first day of the AFTER segment (the dated step). */
  breakDate: string;
  beforeMean: number;
  afterMean: number;
  direction: "up" | "down";
  /** |Δmean| in robust-σ units, rounded to 1dp (the model never cites it). */
  magnitude: number;
}

/**
 * The stable metrics the changepoint reader scans. Deliberately small — the
 * "changed-and-stayed" question is meaningful for these vitals; the noisy
 * activity/audio series are excluded to keep the firing bar honest.
 */
const CHANGEPOINT_METRICS: readonly MeasurementType[] = [
  "RESTING_HEART_RATE",
  "HEART_RATE_VARIABILITY",
  "WEIGHT",
  "BLOOD_PRESSURE_SYS",
  "BLOOD_GLUCOSE",
];

/** Window the reader looks back over (days). */
export const CHANGEPOINT_WINDOW_DAYS = 90;
/** At most this many changepoints in one snapshot (strongest first). */
const MAX_CHANGEPOINTS = 2;

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * v1.44 — the metrics the health-status surface scans: the five above plus
 * every other vital with a stable daily level and enough readings to carry a
 * 180-day window. Activity volumes, audio and sleep stay out: the first two are
 * day-to-day behaviour rather than a level, and a sleep "day mean" over stage
 * rows is not a night. Wrist temperature stays out for the same privacy reason
 * it is not a correlation channel.
 */
export const EXTENDED_CHANGEPOINT_METRICS: readonly MeasurementType[] = [
  ...CHANGEPOINT_METRICS,
  "HRV_RMSSD",
  "BLOOD_PRESSURE_DIA",
  "PULSE",
  "BODY_FAT",
  "RESPIRATORY_RATE",
  "OXYGEN_SATURATION",
  "WALKING_HEART_RATE_AVERAGE",
  "VO2_MAX",
];

/** Window of the extended scan (days). */
export const EXTENDED_CHANGEPOINT_WINDOW_DAYS = 180;
/** At most this many shifts on the health-status surface. */
const MAX_EXTENDED_CHANGEPOINTS = 5;

/** A changepoint with the day counts of the two segments it compares. */
export interface ExtendedChangepointSignal extends ChangepointSignal {
  /** Days with a value before the break. */
  beforeDays: number;
  /** Days with a value from the break on. */
  afterDays: number;
}

/**
 * Scan a metric set for one validated shift each, fault-isolated per metric,
 * strongest first, capped. One per-day read per metric (DAY rollups, or the
 * per-day SQL fold for a window past the DAY tier), never raw readings in
 * process, so the cost is a row per day per metric whatever the density.
 */
async function scanChangepoints(
  userId: string,
  now: Date,
  metrics: readonly MeasurementType[],
  windowDays: number,
  max: number,
): Promise<ExtendedChangepointSignal[]> {
  const coverage = await probeRollupCoverage(userId);
  const found: ExtendedChangepointSignal[] = [];

  for (const metric of metrics) {
    try {
      const { points } = await readDayMeanSeries(
        userId,
        metric,
        windowDays,
        now,
        coverage,
      );
      if (points.length === 0) continue;
      const shift = detectLevelShift(points.map((p) => p.mean));
      if (!shift) continue;
      const breakDate =
        points[shift.breakIndex + 1]?.day ?? points[shift.breakIndex].day;
      found.push({
        metric,
        breakDate,
        beforeMean: round1(shift.beforeMean),
        afterMean: round1(shift.afterMean),
        direction: shift.direction,
        magnitude: round1(shift.magnitude),
        beforeDays: shift.breakIndex + 1,
        afterDays: points.length - shift.breakIndex - 1,
      });
    } catch {
      // Fault-isolated — skip this metric, keep scanning.
    }
  }

  found.sort((a, b) => b.magnitude - a.magnitude);
  return found.slice(0, max);
}

/**
 * v1.44 — the health-status scan: {@link EXTENDED_CHANGEPOINT_METRICS} over
 * {@link EXTENDED_CHANGEPOINT_WINDOW_DAYS} days, a metric whose module is off
 * left unread. The Coach keeps {@link buildChangepointSignals}: what reaches a
 * model is not widened by this.
 */
export async function buildExtendedChangepointSignals(
  userId: string,
  now: Date,
  modules: SurfaceModuleMap,
): Promise<ExtendedChangepointSignal[]> {
  const metrics = EXTENDED_CHANGEPOINT_METRICS.filter((metric) => {
    const owner = moduleForMeasurementType(metric);
    return owner === null || modules[owner] !== false;
  });
  return scanChangepoints(
    userId,
    now,
    metrics,
    EXTENDED_CHANGEPOINT_WINDOW_DAYS,
    MAX_EXTENDED_CHANGEPOINTS,
  );
}

/**
 * Read the DAY-mean series for a small set of stable metrics and surface any
 * validated level shift. Best-effort + fault-isolated per metric: a read
 * failure on one metric never sinks the others. Returns the strongest
 * changepoints (by magnitude), capped, or an empty array when nothing fires.
 */
export async function buildChangepointSignals(
  userId: string,
  now: Date = new Date(),
): Promise<ChangepointSignal[]> {
  const found = await scanChangepoints(
    userId,
    now,
    CHANGEPOINT_METRICS,
    CHANGEPOINT_WINDOW_DAYS,
    MAX_CHANGEPOINTS,
  );
  // The Coach snapshot's shape is unchanged: no segment day counts.
  return found.map((signal) => ({
    metric: signal.metric,
    breakDate: signal.breakDate,
    beforeMean: signal.beforeMean,
    afterMean: signal.afterMean,
    direction: signal.direction,
    magnitude: signal.magnitude,
  }));
}
