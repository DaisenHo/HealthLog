/**
 * v1.44 — training load as fitness, fatigue and form, from the stored daily
 * training impulse.
 *
 * The impulse is the Banister TRIMP the nightly strain run already writes to
 * `strain_trimp_cache` (one row per scored UTC day; a day without a row
 * carried no impulse). Over it run the two exponentially weighted averages
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
 * Run the model from the first stored day through `asOf` (inclusive), a
 * missing day counting as zero impulse. Rows after `asOf` are ignored.
 */
export function computeTrainingLoad(
  rows: ReadonlyArray<{ day: string; dayTrimp: number }>,
  asOf: string,
): TrainingLoad {
  const byDay = new Map<string, number>();
  for (const row of rows) {
    if (row.day > asOf || !Number.isFinite(row.dayTrimp)) continue;
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
  for (let day = days[0]; day <= asOf; day = shiftDateKey(day, 1)) {
    const tsb = ctl - atl;
    const load = byDay.get(day) ?? 0;
    ctl += (load - ctl) / CTL_DAYS;
    atl += (load - atl) / ATL_DAYS;
    daysCovered += 1;
    series.push({ day, ctl, atl, tsb });
  }

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
    warmingUp: daysCovered < CTL_DAYS,
    series: series.slice(-TRAINING_LOAD_SERIES_DAYS).map((p) => ({
      day: p.day,
      ctl: round1(p.ctl),
      atl: round1(p.atl),
      tsb: round1(p.tsb),
    })),
  };
}

/** Read the stored impulse and run the model up to the last scored day. */
export async function readTrainingLoad(
  userId: string,
  now: Date = new Date(),
): Promise<TrainingLoad> {
  // The strain run scores the previous UTC day (`scoreDayKey`). Restated
  // here rather than imported: `score-row` sits on the score writers' import
  // graph, and this read stays off it.
  // eslint-disable-next-line healthlog/no-utc-day-key -- UTC by design: the strain cache is keyed on the UTC score day
  const asOf = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  const rows = await prisma.strainTrimpCache.findMany({
    where: {
      userId,
      day: { gte: shiftDateKey(asOf, -TRAINING_LOAD_READ_DAYS), lte: asOf },
    },
    orderBy: { day: "asc" },
    take: TRAINING_LOAD_READ_DAYS + 1,
    select: { day: true, dayTrimp: true },
  });
  return computeTrainingLoad(rows, asOf);
}
