/**
 * The write-time duplicate pick of `POST /api/workouts/batch`.
 *
 * The rows a batch is about to insert are clustered together with the stored
 * workouts around them, read through the same windowed reader the list uses,
 * so a cluster boundary falls where every read will later draw it. Clustering
 * the batch alone could merge a row into a cluster the list then splits (a
 * stored 09:58 run anchors a cluster with an incoming 10:02, which leaves an
 * incoming 10:06 a session of its own) and drop a workout the list would have
 * shown.
 */
import type { MeasurementSource, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

import {
  incomingWorkoutsToKeep,
  readWorkoutsAroundRange,
} from "./canonical-read";

/** The indexes of the batch rows to write; the rest are duplicates. */
export async function batchWorkoutIndicesToKeep(
  userId: string,
  prepared: ReadonlyArray<{
    index: number;
    row: Prisma.WorkoutCreateManyInput;
  }>,
  priorityJson: unknown,
): Promise<Set<number>> {
  if (prepared.length === 0) return new Set();
  const incoming = prepared.map((p) => ({
    index: p.index,
    userId: p.row.userId,
    sportType: p.row.sportType,
    startedAt: p.row.startedAt as Date,
    durationSec: p.row.durationSec,
    // Zod's `measurementSourceEnum.optional().default("MANUAL")` guarantees
    // `source` is set post-parse, but Prisma's `WorkoutCreateManyInput` types
    // it optional.
    source: (p.row.source ?? "MANUAL") as MeasurementSource,
    avgHeartRate: p.row.avgHeartRate ?? null,
    maxHeartRate: p.row.maxHeartRate ?? null,
    metadata: p.row.metadata ?? null,
  }));
  const starts = incoming.map((row) => row.startedAt.getTime());
  const stored = await readWorkoutsAroundRange(
    {
      from: new Date(Math.min(...starts)),
      to: new Date(Math.max(...starts)),
      inclusiveEnd: true,
    },
    (bounds) =>
      prisma.workout.findMany({
        where: { userId, startedAt: bounds },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          userId: true,
          source: true,
          sportType: true,
          startedAt: true,
          durationSec: true,
          avgHeartRate: true,
          maxHeartRate: true,
          metadata: true,
        },
      }),
  );
  return new Set(
    incomingWorkoutsToKeep(stored, incoming, priorityJson).map(
      (row) => row.index,
    ),
  );
}
