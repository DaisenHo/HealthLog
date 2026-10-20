/**
 * Intraday pulse shape + the elevated-at-rest ("tension") window.
 *
 * Two deterministic, IO-free computations that reveal the SHAPE of a single
 * day's heart rate and, cautiously, whether a stretch of it looks like tension
 * rather than exercise:
 *
 *   1. `computeTenMinuteMeanSeries` — folds the day's raw PULSE samples into
 *      10-minute means in the user's local time. Computed ON DEMAND for the
 *      viewed day (read-swap; the same fold the hourly-mean retention uses),
 *      never persisted as 10-min rollups for all history.
 *   2. `detectTensionWindow` — the differentiator. The tension signal is NOT
 *      raw HR (that conflates a workout with stress): it is heart rate
 *      SUSTAINED above the user's personal RESTING baseline WHILE movement is
 *      low — the "elevated-at-rest window". A workout-overlapping or
 *      high-step bucket can never qualify, so a hard run does not read as
 *      tension. Where intraday HRV exists (WHOOP), it is surfaced as a
 *      confirming flag but is never required.
 *
 * The launch posture is deliberately conservative — "says less than it could".
 * A window is only reported when baseline maturity, per-bucket sample density,
 * a mandatory low-movement gate, and a minimum sustained duration ALL hold.
 * Silence over speculation. This is descriptive context, never a clinical
 * stress diagnosis.
 *
 * Pure & deterministic — unit-tested in `__tests__/intraday-pulse.test.ts`.
 */
import { formatInUserTz } from "@/lib/tz/format";

/** Intraday bucket width, in minutes. Ten minutes reveals the day's shape. */
export const BUCKET_MINUTES = 10;

/**
 * S11 day-navigator fallback bucket width, in minutes. Days older than
 * `DENSE_INTRADAY_RETENTION_DAYS` (`dense-intraday-retention.ts`) have their
 * raw per-sample rows folded to one `stats:` hourly-mean row per local hour;
 * `computeHourlyMeanSeries` re-buckets those at this coarser grain instead of
 * pretending they carry 10-minute resolution.
 */
export const HOURLY_BUCKET_MINUTES = 60;

/**
 * The resolution the intraday series was actually computed at — surfaced on
 * the DTO so the chart can label a folded, older day honestly instead of
 * implying every day carries the same 10-minute detail. `"tenMin"` reads
 * raw per-sample rows; `"hourly"` reads the folded `stats:` tier
 * (`loadIntradayPulse`'s fallback for a day outside the dense retention
 * window). The tension-window detector requires `"tenMin"` resolution — see
 * `detectTensionWindow`'s docblock.
 */
export type IntradayResolution = "tenMin" | "hourly";

/**
 * A 10-minute bucket needs at least this many raw samples before it is
 * TRUSTED as a mean. A lone reading is a point, not a bucket — trusting it
 * would let a single spike masquerade as a sustained stretch. Sub-floor
 * buckets are treated as gaps that BREAK a candidate run (density gate).
 */
export const MIN_SAMPLES_PER_BUCKET = 2;

/**
 * How far above the resting baseline a bucket's mean must sit to count as
 * "elevated". Twelve bpm keeps normal ambient drift (standing, a warm room,
 * digestion) below the line — only a genuine, sustained lift clears it. The
 * bar is deliberately high; under-flagging is the intended failure mode.
 */
export const ELEVATION_MARGIN_BPM = 12;

/**
 * Steps within a 10-minute bucket at or above this count mark the bucket as
 * MOVING — a walk the raw HR would otherwise read as an elevated-at-rest
 * stretch. Sixty steps in ten minutes is a slow amble; anything at or above
 * it disqualifies the bucket from the tension window.
 */
export const STEP_MOVEMENT_THRESHOLD = 60;

/**
 * A day needs at least this many step buckets before a low / absent step
 * reading can be TRUSTED as "genuinely not moving" rather than "steps simply
 * weren't recorded". Below this coverage the low-movement gate cannot be
 * satisfied and no window is reported — the movement gate is mandatory, and a
 * missing step stream is silence, not evidence of rest.
 */
export const MIN_STEP_COVERAGE_BUCKETS = 6;

/**
 * The minimum run of consecutive qualifying buckets before a window is
 * reported: three 10-minute buckets = 30 sustained minutes. A single elevated
 * bucket (a flight of stairs, a phone call) is noise; half an hour of
 * elevated-at-rest heart rate is a shape worth a cautious word.
 */
export const MIN_SUSTAINED_BUCKETS = 3;

/**
 * Minimum number of resting-baseline days before the baseline is mature enough
 * to judge a single day against. A baseline built from two readings is not a
 * personal norm yet — until it matures, no window is reported.
 */
export const MIN_BASELINE_DAYS = 7;

/** A timestamped heart-rate sample (raw PULSE). */
export interface IntradaySample {
  measuredAt: Date;
  value: number;
}

/** A 10-minute mean bucket, anchored on its start minute-of-local-day. */
export interface IntradayHrBucket {
  /** Minutes since local midnight at the bucket's start (0, 10, 20, …). */
  startMinute: number;
  /** Mean of the raw samples that fell in the bucket. */
  mean: number;
  /** Raw sample count — buckets below `MIN_SAMPLES_PER_BUCKET` are gaps. */
  count: number;
  /**
   * v1.30.7 — the bucket's low / high bpm, when known: the min/max of the raw
   * samples (raw path) or the device-supplied `discreteMin`/`discreteMax` (an
   * uploaded 10-min bucket). Absent when the source carries no spread. Drives
   * the intraday envelope band around `mean`.
   */
  min?: number;
  max?: number;
}

/** A workout's local-day span, in minutes since local midnight. */
export interface WorkoutInterval {
  startMinute: number;
  endMinute: number;
}

/** Coarse part-of-day label a window's midpoint falls in. */
export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

/** A detected elevated-at-rest window — a cautious tension marker. */
export interface TensionWindow {
  /** Window start / end, minutes since local midnight. */
  startMinute: number;
  endMinute: number;
  /** Part of day the window's midpoint falls in (drives the copy). */
  partOfDay: PartOfDay;
  /** Mean HR across the window's buckets. */
  meanHr: number;
  /** The resting baseline the window was judged against. */
  baseline: number;
  /** True when intraday HRV independently confirmed the stretch (WHOOP). */
  hrvConfirmed: boolean;
}

/** Local wall-clock projection of an instant: day key + minute-of-day. */
export interface LocalWallClock {
  dayKey: string;
  minuteOfDay: number;
}

/** Resolves an instant to the viewer's local day key + minute-of-day. */
export type LocalResolver = (d: Date) => LocalWallClock;

/**
 * Build a `LocalResolver` for a timezone from the shared tz formatter. Kept
 * here so the pure computations stay tz-correct without every caller
 * re-deriving the wall-clock math; tests inject their own resolver for
 * deterministic, tz-free fixtures.
 */
export function makeLocalResolver(tz: string): LocalResolver {
  return (d: Date) => {
    // "YYYY-MM-DD HH:mm" in the target zone — one formatter, no drift.
    const wall = formatInUserTz(d, tz, "datetime");
    const [dayKey, clock] = wall.split(" ");
    const [hh, mm] = clock.split(":");
    return {
      dayKey,
      minuteOfDay: parseInt(hh, 10) * 60 + parseInt(mm, 10),
    };
  };
}

/** Round to one decimal — keeps the mean readable without false precision. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Fold a day's raw PULSE samples into ascending 10-minute mean buckets. Only
 * samples whose LOCAL day matches `dayKey` participate, so a 23:55-local
 * reading never bleeds into the next day's shape. Empty or sparse buckets are
 * simply absent — the series is the buckets that exist, not a padded grid.
 */
export function computeTenMinuteMeanSeries(
  samples: ReadonlyArray<IntradaySample>,
  dayKey: string,
  localOf: LocalResolver,
): IntradayHrBucket[] {
  const acc = new Map<
    number,
    { sum: number; count: number; min: number; max: number }
  >();
  for (const s of samples) {
    const local = localOf(s.measuredAt);
    if (local.dayKey !== dayKey) continue;
    const startMinute =
      Math.floor(local.minuteOfDay / BUCKET_MINUTES) * BUCKET_MINUTES;
    const bucket = acc.get(startMinute);
    if (bucket) {
      bucket.sum += s.value;
      bucket.count += 1;
      bucket.min = Math.min(bucket.min, s.value);
      bucket.max = Math.max(bucket.max, s.value);
    } else {
      acc.set(startMinute, {
        sum: s.value,
        count: 1,
        min: s.value,
        max: s.value,
      });
    }
  }
  return [...acc.entries()]
    .map(([startMinute, { sum, count, min, max }]) => ({
      startMinute,
      mean: round1(sum / count),
      count,
      // v1.30.7 — carry the raw spread for the envelope band, for parity with
      // an uploaded bucket's device-supplied min/max.
      min: round1(min),
      max: round1(max),
    }))
    .sort((a, b) => a.startMinute - b.startMinute);
}

/**
 * v1.30.7 (iOS #34) — build the 10-minute series directly from UPLOADED
 * aggregated HR buckets (`stats:HKQuantityTypeIdentifierHeartRate:<10-min-Z>`
 * rows), one bucket per slot. Each row already IS a 10-minute mean, so it maps
 * 1:1 to a plotted point; `min`/`max` carry the device's `discreteMin`/`Max`.
 *
 * A device-computed bucket statistic summarises many raw samples the client
 * aggregated on-device, so it is treated as DENSE — assigned a synthetic
 * `count` of `MIN_SAMPLES_PER_BUCKET` so tension detection stays enabled on a
 * bucket-native day (the wire carries no sample count; see the contract doc's
 * open-risks note on the density gate).
 *
 * `bucketStart` is the canonical UTC 10-min boundary from the externalId
 * (resolved to the local slot), NOT the row's `measuredAt` (which carries the
 * display offset). Last write wins on the rare slot collision (:45-offset
 * zones can skew two UTC buckets toward one local slot).
 */
export function computeUploadedBucketSeries(
  buckets: ReadonlyArray<{
    bucketStart: Date;
    mean: number;
    min: number | null;
    max: number | null;
  }>,
  dayKey: string,
  localOf: LocalResolver,
): IntradayHrBucket[] {
  const acc = new Map<number, IntradayHrBucket>();
  for (const b of buckets) {
    const local = localOf(b.bucketStart);
    if (local.dayKey !== dayKey) continue;
    const startMinute =
      Math.floor(local.minuteOfDay / BUCKET_MINUTES) * BUCKET_MINUTES;
    acc.set(startMinute, {
      startMinute,
      mean: round1(b.mean),
      count: MIN_SAMPLES_PER_BUCKET,
      ...(b.min != null ? { min: round1(b.min) } : {}),
      ...(b.max != null ? { max: round1(b.max) } : {}),
    });
  }
  return [...acc.values()].sort((a, b) => a.startMinute - b.startMinute);
}

/**
 * Fold a day's already-folded `stats:` hourly-mean rows into ascending
 * per-local-hour buckets — the day-navigator's fallback shape for a day
 * outside the dense retention window, where the raw per-sample rows are
 * long tombstoned and only the hourly means survive live. Only samples
 * whose LOCAL day matches `dayKey` participate, same as
 * `computeTenMinuteMeanSeries`. Bucket `count` reflects how many `stats:`
 * rows landed in that local hour — normally exactly one (the dense-tier
 * fold mints at most one hourly row per hour), so the density gate in
 * `detectTensionWindow` would reject every bucket outright; callers must
 * not feed this series into tension detection regardless (see
 * `IntradayResolution`).
 */
export function computeHourlyMeanSeries(
  samples: ReadonlyArray<IntradaySample>,
  dayKey: string,
  localOf: LocalResolver,
): IntradayHrBucket[] {
  const acc = new Map<number, { sum: number; count: number }>();
  for (const s of samples) {
    const local = localOf(s.measuredAt);
    if (local.dayKey !== dayKey) continue;
    const startMinute =
      Math.floor(local.minuteOfDay / HOURLY_BUCKET_MINUTES) *
      HOURLY_BUCKET_MINUTES;
    const bucket = acc.get(startMinute);
    if (bucket) {
      bucket.sum += s.value;
      bucket.count += 1;
    } else {
      acc.set(startMinute, { sum: s.value, count: 1 });
    }
  }
  return [...acc.entries()]
    .map(([startMinute, { sum, count }]) => ({
      startMinute,
      mean: round1(sum / count),
      count,
    }))
    .sort((a, b) => a.startMinute - b.startMinute);
}

/** Coarse part-of-day for a minute-of-day (drives the cautious copy). */
export function partOfDayForMinute(minute: number): PartOfDay {
  const hour = Math.floor(minute / 60);
  if (hour < 6) return "night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/** Whether a 10-minute bucket [start, start+10) intersects any workout. */
function overlapsWorkout(
  startMinute: number,
  workouts: ReadonlyArray<WorkoutInterval>,
): boolean {
  const end = startMinute + BUCKET_MINUTES;
  return workouts.some((w) => w.startMinute < end && w.endMinute > startMinute);
}

export interface DetectTensionInput {
  /** The day's 10-minute HR buckets (any order; re-sorted internally). */
  buckets: ReadonlyArray<IntradayHrBucket>;
  /** Personal resting baseline (bpm), or null when unknown. */
  baseline: number | null;
  /** Whether the baseline is built from enough history to trust. */
  baselineMature: boolean;
  /** Steps per 10-minute bucket, keyed by bucket start minute. */
  stepBuckets: ReadonlyMap<number, number>;
  /** Workout spans (local minutes) — buckets overlapping one never qualify. */
  workouts: ReadonlyArray<WorkoutInterval>;
  /** Bucket start-minutes where intraday HRV independently confirms (WHOOP). */
  hrvConfirmMinutes?: ReadonlyArray<number>;
}

/**
 * Detect at most ONE elevated-at-rest window for the day, or null. A bucket
 * qualifies only when it is (a) elevated ≥ `baseline + ELEVATION_MARGIN_BPM`,
 * (b) NOT overlapping a workout, and (c) low-movement — its step count is below
 * `STEP_MOVEMENT_THRESHOLD` AND the day has enough step coverage to trust that
 * reading. The longest run of ≥ `MIN_SUSTAINED_BUCKETS` consecutive qualifying
 * buckets becomes the window (earliest wins a tie). Every gate must hold; when
 * any fails, the honest answer is no window.
 *
 * Callers must only invoke this against `"tenMin"`-resolution buckets
 * (`computeTenMinuteMeanSeries`) — never the `"hourly"` day-navigator
 * fallback (`computeHourlyMeanSeries`). A tension read needs per-sample
 * resolution to sustain the run/density gates honestly; an hourly mean would
 * either starve every bucket via the density gate (misleadingly silent) or,
 * worse, pass it on a coincidence of the hourly average. `loadIntradayPulse`
 * enforces this by only calling `detectTensionWindow` for `"tenMin"` days.
 */
export function detectTensionWindow(
  input: DetectTensionInput,
): TensionWindow | null {
  const { baseline, baselineMature, stepBuckets, workouts } = input;

  // Gate 1 — baseline maturity. No personal norm yet ⇒ say nothing.
  if (baseline == null || !baselineMature) return null;

  // Gate 2 — movement is MANDATORY and step-based. Without enough step
  // coverage a low/absent reading is "not recorded", not "not moving", so the
  // low-movement gate can never be satisfied and no window is reported.
  if (stepBuckets.size < MIN_STEP_COVERAGE_BUCKETS) return null;

  const threshold = baseline + ELEVATION_MARGIN_BPM;
  const hrvMinutes = new Set(input.hrvConfirmMinutes ?? []);

  // Only density-passing buckets participate; a sparse bucket is a gap that
  // breaks a run (we cannot assert "sustained" across missing data).
  const valid = [...input.buckets]
    .filter((b) => b.count >= MIN_SAMPLES_PER_BUCKET)
    .sort((a, b) => a.startMinute - b.startMinute);

  const qualifies = (b: IntradayHrBucket): boolean => {
    if (b.mean < threshold) return false;
    if (overlapsWorkout(b.startMinute, workouts)) return false;
    const steps = stepBuckets.get(b.startMinute) ?? 0;
    return steps < STEP_MOVEMENT_THRESHOLD;
  };

  // Longest run of CONSECUTIVE qualifying buckets (consecutive = adjacent
  // 10-minute slots; any non-qualifying or missing slot breaks the run).
  let best: IntradayHrBucket[] = [];
  let run: IntradayHrBucket[] = [];
  for (const b of valid) {
    const prev = run[run.length - 1];
    const consecutive =
      prev && b.startMinute === prev.startMinute + BUCKET_MINUTES;
    if (qualifies(b)) {
      run = consecutive ? [...run, b] : [b];
    } else {
      run = [];
    }
    if (run.length > best.length) best = run;
  }

  if (best.length < MIN_SUSTAINED_BUCKETS) return null;

  const startMinute = best[0].startMinute;
  const endMinute = best[best.length - 1].startMinute + BUCKET_MINUTES;
  const meanHr = round1(best.reduce((sum, b) => sum + b.mean, 0) / best.length);
  const hrvConfirmed = best.some((b) => hrvMinutes.has(b.startMinute));

  return {
    startMinute,
    endMinute,
    partOfDay: partOfDayForMinute(Math.floor((startMinute + endMinute) / 2)),
    meanHr,
    baseline,
    hrvConfirmed,
  };
}
