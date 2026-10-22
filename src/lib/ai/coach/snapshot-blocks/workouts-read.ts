/**
 * The workout rows the Coach's workouts block narrates, read through the
 * windowed reader so a session two sources recorded collapses to the row the
 * workout list shows, also at the edge of the Coach's window.
 */
import { prisma } from "@/lib/db";
import { readWorkoutsAroundRange } from "@/lib/workouts/canonical-read";

export function readCoachWorkoutRows(userId: string, since: Date) {
  return readWorkoutsAroundRange({ from: since, to: null }, (bounds) =>
    prisma.workout.findMany({
      where: { userId, startedAt: bounds },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        sportType: true,
        startedAt: true,
        durationSec: true,
        totalEnergyKcal: true,
        totalDistanceM: true,
        avgHeartRate: true,
        maxHeartRate: true,
        // Needed by the canonical pick in the block builder to collapse a
        // dual-source session (e.g. Apple Watch + WHOOP recording the same
        // run) to one, matching `GET /api/workouts`.
        source: true,
      },
    }),
  );
}
