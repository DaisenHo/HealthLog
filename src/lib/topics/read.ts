/**
 * The reads behind the topic pages. Every one is a read the single-metric
 * pages already make, so a topic never shows a value its metric page would
 * not:
 *
 *  - measurement days: `readLocalDailyStats`, the canonical-source local-day
 *    value the charts draw (a cumulative type's day total, a pulse-like
 *    type's mean of hourly means), in one query for every type a page needs;
 *  - sleep: the night's time asleep as the sleep page reconstructs it
 *    (`readNightCells`), keyed by the day the night ended;
 *  - mood: the day's mean of its entries' 1–5 score;
 *  - the extra blocks: the training load the workouts page shows, the lab
 *    markers with the trend the marker page shows, the screener trends of the
 *    check-in page, and today's place in the cycle as the cycle page decides
 *    it.
 *
 * The caller decides what may be read (module switches, the grant's
 * sections); a signal or block it leaves out is never queried.
 */
import type { MeasurementType } from "@/generated/prisma/enums";
import { readTodayCycle } from "@/lib/cycle/today-verdict";
import { readLocalDailyStats } from "@/lib/day/daily-stats";
import { prisma } from "@/lib/db";
import {
  readTrainingLoad,
  type TrainingLoad,
} from "@/lib/insights/training-load";
import {
  computeAssessmentTrends,
  TREND_INSTRUMENTS,
  type AssessmentTrend,
} from "@/lib/mental-health/assessment-trend";
import { loadUserSourcePriority } from "@/lib/rollups/measurement-read";
import { readNightCells } from "@/lib/timeline/series";
import { daysBetweenDateKeys, shiftDateKey } from "@/lib/tz/format";
import { startOfLocalDayKey } from "@/lib/tz/local-day";

import { readLabPanel, type TopicLabPanel } from "./labs";
import { MOOD_SIGNAL, type TopicExtra, type TopicSignalKey } from "./registry";
import type { DaySeries } from "./stats";

/** Screener administrations the trends read; the cap falls on the oldest. */
const SCREENER_READ_CAP = 1500;

/** Cycle lengths the cycle block reports, newest kept. */
const CYCLE_LENGTHS_SHOWN = 6;

/** A plausible cycle length; anything outside is a gap in logging. */
const CYCLE_LENGTH_MIN_DAYS = 15;
const CYCLE_LENGTH_MAX_DAYS = 60;

export interface TopicCycleSummary {
  /** Today's cycle day and phase, or null while the cycle is still learned. */
  today: { dayOfCycle: number; phase: string | null } | null;
  /** Lengths of the completed cycles, oldest first, at most six. */
  lengths: number[];
  /** Mean of `lengths`, or null with none. */
  averageLength: number | null;
  /** Logged period starts on record. */
  periodsLogged: number;
}

export interface TopicReadRequest {
  userId: string;
  tz: string;
  todayKey: string;
  /** First local day to read (inclusive); the last is `todayKey`. */
  fromKey: string;
  signals: ReadonlySet<TopicSignalKey>;
  extras: ReadonlySet<TopicExtra>;
  now: Date;
}

export interface TopicInputs {
  series: Map<TopicSignalKey, DaySeries>;
  labs: TopicLabPanel | null;
  training: TrainingLoad | null;
  screeners: AssessmentTrend[] | null;
  cycle: TopicCycleSummary | null;
}

async function readMeasurementDays(
  req: TopicReadRequest,
  types: MeasurementType[],
  priorityJson: unknown,
): Promise<Map<TopicSignalKey, DaySeries>> {
  const out = new Map<TopicSignalKey, DaySeries>();
  if (types.length === 0) return out;
  const stats = await readLocalDailyStats({
    userId: req.userId,
    types,
    from: startOfLocalDayKey(req.fromKey, req.tz),
    to: startOfLocalDayKey(shiftDateKey(req.todayKey, 1), req.tz),
    tz: req.tz,
    priorityJson,
  });
  for (const [type, days] of stats) {
    if (days.size > 0) out.set(type, days);
  }
  return out;
}

async function readSleepNights(
  req: TopicReadRequest,
  priorityJson: unknown,
): Promise<DaySeries | null> {
  const cells = await readNightCells({
    userId: req.userId,
    from: req.fromKey,
    to: req.todayKey,
    tz: req.tz,
    priorityJson,
  });
  if (cells.size === 0) return null;
  const out = new Map<string, number>();
  for (const [day, cell] of cells) out.set(day, cell.value);
  return out;
}

async function readMoodDays(req: TopicReadRequest): Promise<DaySeries | null> {
  const rows = await prisma.moodEntry.groupBy({
    by: ["date"],
    where: {
      userId: req.userId,
      deletedAt: null,
      date: { gte: req.fromKey, lte: req.todayKey },
    },
    _avg: { score: true },
  });
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row._avg.score !== null) out.set(row.date, row._avg.score);
  }
  return out.size > 0 ? out : null;
}

async function readScreenerTrends(userId: string): Promise<AssessmentTrend[]> {
  const rows = await prisma.mentalHealthAssessment.findMany({
    where: { userId, deletedAt: null, instrument: { in: TREND_INSTRUMENTS } },
    orderBy: [{ takenAt: "desc" }, { id: "desc" }],
    take: SCREENER_READ_CAP,
    select: { id: true, instrument: true, totalScore: true, takenAt: true },
  });
  return computeAssessmentTrends(rows);
}

/** Lengths between consecutive logged period starts, plausible ones only. */
export function completedCycleLengths(starts: readonly string[]): number[] {
  const sorted = [...starts].sort();
  const lengths: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const length = daysBetweenDateKeys(sorted[i - 1], sorted[i]);
    if (length >= CYCLE_LENGTH_MIN_DAYS && length <= CYCLE_LENGTH_MAX_DAYS) {
      lengths.push(length);
    }
  }
  return lengths.slice(-CYCLE_LENGTHS_SHOWN);
}

async function readCycleSummary(
  req: TopicReadRequest,
): Promise<TopicCycleSummary | null> {
  const [today, cycles] = await Promise.all([
    readTodayCycle(req.userId, req.tz, req.now),
    prisma.menstrualCycle.findMany({
      where: { userId: req.userId, deletedAt: null, isPredicted: false },
      orderBy: { startDate: "asc" },
      select: { startDate: true },
    }),
  ]);
  const starts = cycles
    .map((c) => c.startDate)
    .filter((day) => day <= req.todayKey);
  if (starts.length === 0 && today === null) return null;
  const lengths = completedCycleLengths(starts);
  const averageLength =
    lengths.length > 0
      ? Math.round((lengths.reduce((s, v) => s + v, 0) / lengths.length) * 10) /
        10
      : null;
  return {
    today: today ? { dayOfCycle: today.dayOfCycle, phase: today.phase } : null,
    lengths,
    averageLength,
    periodsLogged: starts.length,
  };
}

/** Read everything one request needs, in parallel. */
export async function readTopicInputs(
  req: TopicReadRequest,
): Promise<TopicInputs> {
  const wantsSleep = req.signals.has("SLEEP_DURATION");
  const wantsMood = req.signals.has(MOOD_SIGNAL);
  const types = [...req.signals].filter(
    (key): key is MeasurementType =>
      key !== MOOD_SIGNAL && key !== "SLEEP_DURATION",
  );
  const needsPriority = types.length > 0 || wantsSleep;
  const priorityJson = needsPriority
    ? await loadUserSourcePriority(req.userId)
    : null;

  const [measurements, sleep, mood, labs, training, screeners, cycle] =
    await Promise.all([
      readMeasurementDays(req, types, priorityJson),
      wantsSleep ? readSleepNights(req, priorityJson) : Promise.resolve(null),
      wantsMood ? readMoodDays(req) : Promise.resolve(null),
      req.extras.has("labs")
        ? readLabPanel(req.userId, req.now)
        : Promise.resolve(null),
      req.extras.has("training")
        ? readTrainingLoad(req.userId, req.now)
        : Promise.resolve(null),
      req.extras.has("screeners")
        ? readScreenerTrends(req.userId)
        : Promise.resolve(null),
      req.extras.has("cycle") ? readCycleSummary(req) : Promise.resolve(null),
    ]);

  const series = measurements;
  if (sleep) series.set("SLEEP_DURATION", sleep);
  if (mood) series.set(MOOD_SIGNAL, mood);
  return { series, labs, training, screeners, cycle };
}
