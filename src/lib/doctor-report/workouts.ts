/**
 * The workouts block of the doctor report: sessions over the window, summed
 * per sport.
 *
 * A clinician reads training volume, not a session log, so the block is a
 * per-sport summary (sessions, total time, distance, energy, mean of the
 * session heart-rate averages) plus the window's weekly figures. Workouts are
 * a sparse table — a handful a week even for a daily athlete — so the rows are
 * read narrow (no metadata, no samples, no route) and collapsed through the
 * canonical-workout picker first, the same rule the workout list applies, so a
 * session two sources reported counts once.
 */
import { prisma } from "@/lib/db";
import { pickCanonicalWorkoutRows } from "@/lib/measurements/pick-canonical-workout-rows";
import type { DoctorReportWorkouts } from "@/lib/doctor-report-types";

/**
 * Sport rows the block lists at most, longest total time first. The totals
 * above the table still count every session, and `sportCount` says how many
 * sports there were.
 */
export const REPORT_WORKOUT_SPORT_CAP = 12;

export async function loadReportWorkouts(params: {
  userId: string;
  start: Date;
  end: Date;
  days: number;
  sourcePriorityJson: unknown;
}): Promise<DoctorReportWorkouts | null> {
  const { userId, start, end, days, sourcePriorityJson } = params;
  const rows = await prisma.workout.findMany({
    where: { userId, startedAt: { gte: start, lte: end } },
    orderBy: { startedAt: "asc" },
    select: {
      sportType: true,
      startedAt: true,
      durationSec: true,
      source: true,
      totalDistanceM: true,
      totalEnergyKcal: true,
      avgHeartRate: true,
    },
  });
  const canonical = pickCanonicalWorkoutRows(rows, sourcePriorityJson);
  return summariseReportWorkouts(canonical, days);
}

/** Pure fold, exported for tests. */
export function summariseReportWorkouts(
  rows: ReadonlyArray<{
    sportType: string;
    durationSec: number;
    totalDistanceM: number | null;
    totalEnergyKcal: number | null;
    avgHeartRate: number | null;
  }>,
  days: number,
): DoctorReportWorkouts | null {
  if (rows.length === 0) return null;
  const bySport = new Map<
    string,
    {
      sessions: number;
      durationSec: number;
      distanceM: number;
      distanceSessions: number;
      energyKcal: number;
      energySessions: number;
      hrSum: number;
      hrSessions: number;
    }
  >();
  let totalDurationSec = 0;
  for (const r of rows) {
    totalDurationSec += r.durationSec;
    const s = bySport.get(r.sportType) ?? {
      sessions: 0,
      durationSec: 0,
      distanceM: 0,
      distanceSessions: 0,
      energyKcal: 0,
      energySessions: 0,
      hrSum: 0,
      hrSessions: 0,
    };
    s.sessions += 1;
    s.durationSec += r.durationSec;
    if (r.totalDistanceM !== null && r.totalDistanceM > 0) {
      s.distanceM += r.totalDistanceM;
      s.distanceSessions += 1;
    }
    if (r.totalEnergyKcal !== null && r.totalEnergyKcal > 0) {
      s.energyKcal += r.totalEnergyKcal;
      s.energySessions += 1;
    }
    if (r.avgHeartRate !== null && r.avgHeartRate > 0) {
      s.hrSum += r.avgHeartRate;
      s.hrSessions += 1;
    }
    bySport.set(r.sportType, s);
  }
  const weeks = Math.max(days, 1) / 7;
  return {
    sessions: rows.length,
    totalDurationSec,
    sessionsPerWeek: rows.length / weeks,
    minutesPerWeek: totalDurationSec / 60 / weeks,
    sportCount: bySport.size,
    bySport: [...bySport.entries()]
      .sort((a, b) => b[1].durationSec - a[1].durationSec)
      .slice(0, REPORT_WORKOUT_SPORT_CAP)
      .map(([sportType, s]) => ({
        sportType,
        sessions: s.sessions,
        durationSec: s.durationSec,
        // A sum over the sessions that reported it, and how many did: a
        // partial distance never reads as the sport's whole distance.
        distanceM: s.distanceSessions > 0 ? s.distanceM : null,
        distanceSessions: s.distanceSessions,
        energyKcal: s.energySessions > 0 ? s.energyKcal : null,
        avgHeartRate: s.hrSessions > 0 ? s.hrSum / s.hrSessions : null,
      })),
  };
}
