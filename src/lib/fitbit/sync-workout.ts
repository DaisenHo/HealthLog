/**
 * Fitbit Web API exercise-session sync.
 *
 * Reads exercise sessions from the classic `activities/list` endpoint
 * (`afterDate` + ascending offset/limit pagination) and upserts each into the
 * `Workout` table as `source = FITBIT`, keyed on `(userId, source, externalId)`
 * (externalId = the Fitbit `logId`) so a re-fetch overwrites in place.
 *
 * A Fitbit run and the same run via Apple Health (or WHOOP) stay distinct
 * `Workout` rows (different `source`); the read-time `pickCanonicalWorkoutRows`
 * picker collapses the cross-source twin per the user's source ladder (FITBIT is
 * already in the default ladder, ranked just below WHOOP). No ingest-time
 * collapse for a server-owned source pair.
 *
 * The page-walk is bounded (the 150 req/h budget is tight): a small page cap
 * covers the incremental window comfortably, and a backfill, bounded by the
 * horizon `afterDate`, may read up to ten thousand sessions. A walk that
 * reaches its cap is reported truncated (`walkPages`), so the backfill is not
 * stamped complete over it. A per-endpoint 403 soft-skips the resource.
 */
import { fetchActivityList, mapWorkout, readActivityList } from "./client";
import type { FitbitMappedWorkout } from "./client";
import { getValidToken, handleCollectionFetchError } from "./sync-core";
import type { FitbitResourceSyncOptions } from "./sync-core";
import { prisma, toJson } from "@/lib/db";
import { emitInsertedWorkoutArrival } from "@/lib/arrivals/workout-emit";
import { annotate, getEvent } from "@/lib/logging/context";
import { resolveUserTimezone } from "@/lib/tz/resolver";
import { walkPages } from "@/lib/integrations/page-walk";

/** Activities per page on the `activities/list` walk. */
const WORKOUT_PAGE_SIZE = 100;
/** Ceiling on pages walked per incremental cycle (rate-budget guard). */
const WORKOUT_MAX_PAGES = 12;
/** Ceiling on pages walked by a backfill. */
const WORKOUT_BACKFILL_MAX_PAGES = 100;

function metadataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function walkActivityList(
  accessToken: string,
  afterDate: Date,
  maxPages: number,
) {
  return walkPages<number, ReturnType<typeof readActivityList>[number]>(
    "fitbit.exercise",
    maxPages,
    async (cursor) => {
      const offset = cursor ?? 0;
      const page = readActivityList(
        await fetchActivityList(accessToken, afterDate, {
          limit: WORKOUT_PAGE_SIZE,
          offset,
        }),
      );
      return {
        items: page,
        next:
          page.length < WORKOUT_PAGE_SIZE ? null : offset + WORKOUT_PAGE_SIZE,
      };
    },
    0,
  );
}

export async function syncUserWorkout(
  userId: string,
  opts: FitbitResourceSyncOptions = {},
): Promise<number> {
  const tokenInfo = await getValidToken(userId);
  if (!tokenInfo) return 0;

  // `startTime` on the activities list is offset-less local wall-clock; anchor
  // it to the user's stored zone rather than the process zone.
  const tz = await resolveUserTimezone(userId);

  const afterDate =
    opts.start ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  let walk: Awaited<ReturnType<typeof walkActivityList>>;
  try {
    walk = await walkActivityList(
      tokenInfo.accessToken,
      afterDate,
      opts.fullSync ? WORKOUT_BACKFILL_MAX_PAGES : WORKOUT_MAX_PAGES,
    );
  } catch (err) {
    return handleCollectionFetchError("fetchExercise", userId, err);
  }

  let imported = 0;
  for (const entry of walk.items) {
    const w: FitbitMappedWorkout | null = mapWorkout(entry, tz);
    if (!w) continue; // no usable time span — not a workout

    const data = {
      sportType: w.sportType,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      durationSec: w.durationSec,
      totalEnergyKcal: w.totalEnergyKcal,
      totalDistanceM: w.totalDistanceM,
      avgHeartRate: w.avgHeartRate,
      maxHeartRate: w.maxHeartRate,
      minHeartRate: w.minHeartRate,
      metadata: toJson(w.metadata),
    };
    const where = {
      userId_source_externalId: {
        userId,
        source: "FITBIT",
        externalId: w.externalId,
      },
    } as const;
    try {
      const [inserted] = await prisma.workout.createManyAndReturn({
        data: {
          userId,
          source: "FITBIT",
          externalId: w.externalId,
          ...data,
        },
        skipDuplicates: true,
        select: { id: true, startedAt: true },
      });
      if (inserted) {
        void emitInsertedWorkoutArrival(userId, inserted, "fitbit").catch(
          () => {},
        );
      } else {
        const existing = await prisma.workout.findUnique({
          where,
          select: { metadata: true },
        });
        await prisma.workout.update({
          where,
          data: {
            ...data,
            metadata: toJson({
              ...metadataRecord(existing?.metadata),
              ...w.metadata,
            }),
          },
        });
      }
      imported++;
    } catch (err) {
      getEvent()?.addWarning(`fitbit: failed to upsert workout: ${err}`);
    }
  }

  // `markSynced` is owned by the orchestrator (`syncUserFitbit`).
  annotate({ action: { name: "fitbit.workout.sync", details: { imported } } });
  return imported;
}
