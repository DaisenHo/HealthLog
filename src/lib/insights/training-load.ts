/**
 * v1.44 — training load as fitness, fatigue and form, from the stored daily
 * training impulse.
 *
 * The impulse is the Banister TRIMP the nightly strain run already writes to
 * `strain_trimp_cache`: one row per scored UTC day, 0 on a scored day without
 * training. The strain run writes no row on a day with neither a scorable
 * workout nor active energy, so a missing row alone does not tell rest from
 * absence. A day without a row is therefore classified from the underlying
 * data:
 *
 *   - a workout on the day: training that could not be scored, not rated;
 *   - steps, heart rate or active energy on the day: the person wore or
 *     carried a device and did not train, rest (impulse 0);
 *   - none of these: nothing reached the server, not rated.
 *
 * An unrated day holds the averages instead of pulling them toward zero.
 * The series runs to the day the strain run scores (yesterday in UTC), so a
 * stretch without data after the last rated day shows as unrated days and
 * in `recentRatedDays`; `asOf` names the last rated day. Over the impulse run
 * the two exponentially weighted averages of the fitness-fatigue model
 * (Banister, Calvert, Savage & Bach 1975; in the time-constant form
 * popularised as chronic and acute training load):
 *
 *   fitness  CTL_d = CTL_{d−1} + (L_d − CTL_{d−1}) / 42
 *   fatigue  ATL_d = ATL_{d−1} + (L_d − ATL_{d−1}) / 7
 *   form     TSB_d = CTL_{d−1} − ATL_{d−1}   (going into day d)
 *
 * Both averages start at zero on the first stored day, so the figures are
 * flagged `warmingUp` until {@link CTL_DAYS} days are covered. The values are
 * in TRIMP units: comparable with the person's own past, not with anyone
 * else's and not with another app's training-stress score. Descriptive only:
 * no performance prediction and no advice. Pure apart from the reads.
 */
import type { MeasurementType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { shiftDateKey } from "@/lib/tz/format";

export const CTL_DAYS = 42;
export const ATL_DAYS = 7;
/** Days of history before the figures are offered at all. */
export const TRAINING_LOAD_MIN_DAYS = 28;
/** Training days (impulse > 0) before the figures are offered at all. */
export const TRAINING_LOAD_MIN_TRAINING_DAYS = 3;
/** Days of history read; the seed's pull is gone long before. */
export const TRAINING_LOAD_READ_DAYS = 365;
/** Trailing days of the series returned for a chart. */
export const TRAINING_LOAD_SERIES_DAYS = 90;

export interface TrainingLoadPoint {
  day: string;
  ctl: number;
  atl: number;
  tsb: number;
  /**
   * False for a day with neither a stored impulse nor any activity data, or
   * with a workout that could not be scored: the averages held through it.
   */
  rated: boolean;
}

export type TrainingLoad =
  | {
      status: "ok";
      /** The last rated day the figures describe (UTC day key). */
      asOf: string;
      ctl: number;
      atl: number;
      /** Form going into the day after `asOf`: CTL − ATL at `asOf`. */
      tsb: number;
      daysCovered: number;
      trainingDays: number;
      /**
       * Rated days (a stored impulse, or activity data without a workout) of
       * the trailing {@link CTL_DAYS} days up to yesterday, or fewer when
       * covered less.
       */
      recentRatedDays: number;
      /** The trailing window `recentRatedDays` counts over. */
      recentDays: number;
      warmingUp: boolean;
      series: TrainingLoadPoint[];
    }
  | {
      status: "insufficient";
      reason: "no_impulse_history" | "too_little_history";
      daysCovered: number;
      trainingDays: number;
    };

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * What the read knows about the days without a stored impulse: the UTC days
 * with any activity data (steps, heart rate, active energy) and the UTC days
 * with a workout.
 */
export interface TrainingLoadActivity {
  dataDays: ReadonlySet<string>;
  workoutDays: ReadonlySet<string>;
}

const NO_ACTIVITY: TrainingLoadActivity = {
  dataDays: new Set(),
  workoutDays: new Set(),
};

/**
 * The impulse of one day, or `undefined` when the day is not rated: the
 * stored impulse when there is one; otherwise rest (0) on a day with
 * activity data and no workout, and not rated on a day with a workout that
 * was never scored or with no data at all.
 */
function dayLoad(
  day: string,
  byDay: ReadonlyMap<string, number>,
  activity: TrainingLoadActivity,
): number | undefined {
  const stored = byDay.get(day);
  if (stored !== undefined) return stored;
  if (activity.workoutDays.has(day)) return undefined;
  return activity.dataDays.has(day) ? 0 : undefined;
}

/**
 * Run the model from the first stored day through `until`. A day is rated
 * as {@link dayLoad} says; an unrated day holds the averages. Rows after
 * `until` are ignored.
 */
export function computeTrainingLoad(
  rows: ReadonlyArray<{ day: string; dayTrimp: number }>,
  until: string,
  activity: TrainingLoadActivity = NO_ACTIVITY,
): TrainingLoad {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.day > until || !Number.isFinite(row.dayTrimp)) continue;
    byDay.set(row.day, Math.max(0, row.dayTrimp));
  }
  const days = [...byDay.keys()].sort();
  const trainingDays = [...byDay.values()].filter((v) => v > 0).length;
  if (days.length === 0 || trainingDays === 0) {
    return {
      status: "insufficient",
      reason: "no_impulse_history",
      daysCovered: 0,
      trainingDays,
    };
  }

  const series: TrainingLoadPoint[] = [];
  let ctl = 0;
  let atl = 0;
  let daysCovered = 0;
  let asOf = days[0];
  let asOfCtl = 0;
  let asOfAtl = 0;
  for (let day = days[0]; day <= until; day = shiftDateKey(day, 1)) {
    const tsb = ctl - atl;
    const load = dayLoad(day, byDay, activity);
    if (load !== undefined) {
      ctl += (load - ctl) / CTL_DAYS;
      atl += (load - atl) / ATL_DAYS;
      asOf = day;
      asOfCtl = ctl;
      asOfAtl = atl;
    }
    daysCovered += 1;
    series.push({ day, ctl, atl, tsb, rated: load !== undefined });
  }
  const recent = series.slice(-CTL_DAYS);
  const recentRatedDays = recent.filter((p) => p.rated).length;

  if (
    daysCovered < TRAINING_LOAD_MIN_DAYS ||
    trainingDays < TRAINING_LOAD_MIN_TRAINING_DAYS
  ) {
    return {
      status: "insufficient",
      reason: "too_little_history",
      daysCovered,
      trainingDays,
    };
  }

  return {
    status: "ok",
    asOf,
    ctl: round1(asOfCtl),
    atl: round1(asOfAtl),
    tsb: round1(asOfCtl - asOfAtl),
    daysCovered,
    trainingDays,
    recentRatedDays,
    recentDays: recent.length,
    warmingUp: daysCovered < CTL_DAYS,
    series: series.slice(-TRAINING_LOAD_SERIES_DAYS).map((p) => ({
      day: p.day,
      ctl: round1(p.ctl),
      atl: round1(p.atl),
      tsb: round1(p.tsb),
      rated: p.rated,
    })),
  };
}

/** The measurement types whose presence on a day says a device was worn or carried. */
export const TRAINING_LOAD_PRESENCE_TYPES: MeasurementType[] = [
  "ACTIVITY_STEPS",
  "PULSE",
  "ACTIVE_ENERGY_BURNED",
];

/**
 * Read the stored impulse, the days with activity data (from the daily
 * rollups) and the days with a workout, and run the model up to the day the
 * strain run scores (yesterday in UTC).
 */
export async function readTrainingLoad(
  userId: string,
  now: Date = new Date(),
): Promise<TrainingLoad> {
  // The strain run scores the previous UTC day (`scoreDayKey`). Restated
  // here rather than imported: `score-row` sits on the score writers' import
  // graph, and this read stays off it.
  // eslint-disable-next-line healthlog/no-utc-day-key -- UTC by design: the strain cache is keyed on the UTC score day
  const until = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const from = shiftDateKey(until, -TRAINING_LOAD_READ_DAYS);
  // eslint-disable-next-line healthlog/no-utc-day-key -- UTC by design: the strain cache is keyed on the UTC score day
  const fromInstant = new Date(`${from}T00:00:00.000Z`);
  // eslint-disable-next-line healthlog/no-utc-day-key -- UTC by design: the strain cache is keyed on the UTC score day
  const endInstant = new Date(`${shiftDateKey(until, 1)}T00:00:00.000Z`);
  const [rows, presence, workoutDays] = await Promise.all([
    prisma.strainTrimpCache.findMany({
      where: { userId, day: { gte: from, lte: until } },
      orderBy: { day: "asc" },
      take: TRAINING_LOAD_READ_DAYS + 1,
      select: { day: true, dayTrimp: true },
    }),
    // Daily rollups bucket on the UTC day, the same day the strain cache
    // keys on.
    prisma.measurementRollup.findMany({
      where: {
        userId,
        granularity: "DAY",
        type: { in: TRAINING_LOAD_PRESENCE_TYPES },
        bucketStart: { gte: fromInstant, lt: endInstant },
        count: { gt: 0 },
      },
      distinct: ["bucketStart"],
      select: { bucketStart: true },
    }),
    // One row per UTC day with a workout; `started_at` is stored as UTC.
    prisma.$queryRaw<Array<{ day: string }>>`
      SELECT DISTINCT to_char("started_at", 'YYYY-MM-DD') AS day
      FROM "workouts"
      WHERE "user_id" = ${userId}
        AND "started_at" >= ${fromInstant} AND "started_at" < ${endInstant}
    `,
  ]);
  return computeTrainingLoad(rows, until, {
    dataDays: new Set(
      // eslint-disable-next-line healthlog/no-utc-day-key -- UTC by design: a DAY rollup bucket starts at UTC midnight
      presence.map((r) => r.bucketStart.toISOString().slice(0, 10)),
    ),
    workoutDays: new Set(workoutDays.map((r) => r.day)),
  });
}
