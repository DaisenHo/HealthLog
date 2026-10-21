/**
 * v1.44 — training load as fitness, fatigue and form, from the stored daily
 * training impulse.
 *
 * The impulse is the Banister TRIMP the nightly strain run already writes to
 * `strain_trimp_cache`: one row per scored UTC day, 0 on a scored day without
 * training. A day WITHOUT a row was never scored (no heart-rate data reached
 * the server, or the run has not happened yet), so it is not rated rather
 * than read as rest: the averages hold through it instead of decaying toward
 * zero, and the figures report how many recent days were rated. The figures
 * describe the last stored day, so a nightly run that has not happened yet
 * never turns yesterday into a rest day. Over it run the two exponentially weighted averages
 * of the fitness-fatigue model (Banister, Calvert, Savage & Bach 1975; in the
 * time-constant form popularised as chronic and acute training load):
 *
 *   fitness  CTL_d = CTL_{d−1} + (L_d − CTL_{d−1}) / 42
 *   fatigue  ATL_d = ATL_{d−1} + (L_d − ATL_{d−1}) / 7
 *   form     TSB_d = CTL_{d−1} − ATL_{d−1}   (going into day d)
 *
 * Both averages start at zero on the first stored day, so the figures are
 * flagged `warmingUp` until {@link CTL_DAYS} days are covered. The values are
 * in TRIMP units: comparable with the person's own past, not with anyone
 * else's and not with another app's training-stress score. Descriptive only:
 * no performance prediction and no advice. Pure apart from the one read.
 */
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
  /** False for a day without a stored impulse: the averages held through it. */
  rated: boolean;
}

export type TrainingLoad =
  | {
      status: "ok";
      /** The last scored day the figures describe (UTC day key). */
      asOf: string;
      ctl: number;
      atl: number;
      /** Form going into the day after `asOf`: CTL − ATL at `asOf`. */
      tsb: number;
      daysCovered: number;
      trainingDays: number;
      /** Days of the trailing {@link CTL_DAYS} (or fewer, when covered less) with a stored impulse. */
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
 * Run the model from the first stored day through the last stored day on or
 * before `until`. A day without a row is not rated: the averages hold through
 * it. Rows after `until` are ignored.
 */
export function computeTrainingLoad(
  rows: ReadonlyArray<{ day: string; dayTrimp: number }>,
  until: string,
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

  const asOf = days[days.length - 1];
  const series: TrainingLoadPoint[] = [];
  let ctl = 0;
  let atl = 0;
  let daysCovered = 0;
  for (let day = days[0]; day <= asOf; day = shiftDateKey(day, 1)) {
    const tsb = ctl - atl;
    const load = byDay.get(day);
    if (load !== undefined) {
      ctl += (load - ctl) / CTL_DAYS;
      atl += (load - atl) / ATL_DAYS;
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
    ctl: round1(ctl),
    atl: round1(atl),
    tsb: round1(ctl - atl),
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

/**
 * Read the stored impulse and run the model up to the last stored day, at
 * most the day the strain run scores (yesterday in UTC).
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
  const rows = await prisma.strainTrimpCache.findMany({
    where: {
      userId,
      day: { gte: shiftDateKey(until, -TRAINING_LOAD_READ_DAYS), lte: until },
    },
    orderBy: { day: "asc" },
    take: TRAINING_LOAD_READ_DAYS + 1,
    select: { day: true, dayTrimp: true },
  });
  return computeTrainingLoad(rows, until);
}
