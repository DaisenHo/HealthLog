/**
 * The workout summaries, with both backup ends in one file. GPS routes and
 * per-sample series do not travel, and the file's manifest says so.
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { toJson } from "@/lib/db";
import type { RestoreContext } from "@/lib/export/restore-context";

// ── Export ───────────────────────────────────────────────────────────────────

export interface WorkoutBackupEntry {
  /** Present in canonical DR payloads for manual workouts without externalId. */
  id?: string;
  createdAt?: string;
  updatedAt?: string;
  sportType: string;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  totalEnergyKcal: number | null;
  totalDistanceM: number | null;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  minHeartRate: number | null;
  stepCount: number | null;
  elevationM: number | null;
  pauseDurationSec: number | null;
  source: string;
  externalId: string | null;
  /** Canonical DR only; portable workout summaries keep their existing shape. */
  metadata?: Prisma.JsonValue;
  /** Canonical DR only, beside `metadata`: the source's own version marker. */
  externalSourceVersion?: string | null;
}

/** The workout slice of the records section: the summaries. */
export async function buildWorkoutsBackupSlice(
  prisma: Pick<PrismaClient, "workout">,
  userId: string,
  disasterRecovery: boolean,
): Promise<{ workouts: WorkoutBackupEntry[] }> {
  const workoutRows = await prisma.workout.findMany({
    where: { userId },
    orderBy: [{ startedAt: "desc" }, { id: "asc" }],
  });

  const workouts: WorkoutBackupEntry[] = workoutRows.map((w) => ({
    ...(disasterRecovery
      ? {
          id: w.id,
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
          ...(w.metadata == null ? {} : { metadata: w.metadata }),
          externalSourceVersion: w.externalSourceVersion,
        }
      : {}),
    sportType: w.sportType,
    startedAt: w.startedAt.toISOString(),
    endedAt: w.endedAt.toISOString(),
    durationSec: w.durationSec,
    totalEnergyKcal: w.totalEnergyKcal,
    totalDistanceM: w.totalDistanceM,
    avgHeartRate: w.avgHeartRate,
    maxHeartRate: w.maxHeartRate,
    minHeartRate: w.minHeartRate,
    stepCount: w.stepCount,
    elevationM: w.elevationM,
    pauseDurationSec: w.pauseDurationSec,
    source: w.source,
    externalId: w.externalId,
  }));
  return { workouts };
}

// ── Restore ──────────────────────────────────────────────────────────────────

export async function clearWorkouts(ctx: RestoreContext): Promise<void> {
  const workouts = await ctx.tx.workout.deleteMany({
    where: { userId: ctx.ownerId },
  });
  ctx.cleared.workouts = workouts.count;
}

export async function restoreWorkouts(ctx: RestoreContext): Promise<void> {
  const { tx, ownerId, payload } = ctx;
  if (payload.workouts.length === 0) return;
  await tx.workout.createMany({
    data: payload.workouts.map((workout) => ({
      ...(workout.id ? { id: workout.id } : {}),
      userId: ownerId,
      sportType: workout.sportType,
      startedAt: new Date(workout.startedAt),
      endedAt: new Date(workout.endedAt),
      durationSec: workout.durationSec,
      totalEnergyKcal: workout.totalEnergyKcal ?? null,
      totalDistanceM: workout.totalDistanceM ?? null,
      avgHeartRate: workout.avgHeartRate ?? null,
      maxHeartRate: workout.maxHeartRate ?? null,
      minHeartRate: workout.minHeartRate ?? null,
      stepCount: workout.stepCount ?? null,
      elevationM: workout.elevationM ?? null,
      pauseDurationSec: workout.pauseDurationSec ?? null,
      source: workout.source as never,
      externalId: workout.externalId ?? null,
      externalSourceVersion: workout.externalSourceVersion ?? null,
      ...(workout.metadata == null
        ? {}
        : { metadata: toJson(workout.metadata) }),
      ...(workout.createdAt ? { createdAt: new Date(workout.createdAt) } : {}),
      ...(workout.updatedAt ? { updatedAt: new Date(workout.updatedAt) } : {}),
    })),
  });
}
