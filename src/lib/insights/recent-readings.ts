/**
 * The raw readings a per-metric status snapshot reads: the latest 365, and
 * never less than the last 30 days.
 *
 * The snapshots used to read `take: 365` rows. For a type read a few times a
 * day that reaches back months; for a dense stream (a watch's pulse every
 * few minutes, hourly folds of an imported history) it reached back hours,
 * and the "last 30 days" figures built on it (in-target share, the resting
 * proxy, the latest day against the one before) were computed over a sliver
 * of one day. When the latest 365 readings do not reach back 30 days, the
 * last 30 days are read by time instead, bounded by {@link DENSE_READ_CAP}
 * so a pathological stream cannot take the heap; hitting the bound is
 * annotated, never silent. The longer tail of every snapshot comes from the
 * rollup tier, not from here.
 */
import type { MeasurementType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { annotate } from "@/lib/logging/context";

export const RECENT_READINGS = 365;
export const RECENT_MIN_DAYS = 30;
/** A reading a minute for 30 days is 43 200; this is above any real stream. */
export const DENSE_READ_CAP = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecentReading {
  value: number;
  measuredAt: Date;
}

/** Oldest first. */
export async function readRecentReadings(
  userId: string,
  type: MeasurementType,
  now: Date = new Date(),
): Promise<RecentReading[]> {
  const latest = await prisma.measurement.findMany({
    where: { userId, type, deletedAt: null },
    orderBy: { measuredAt: "desc" },
    take: RECENT_READINGS,
    select: { value: true, measuredAt: true },
  });
  const since = new Date(now.getTime() - RECENT_MIN_DAYS * DAY_MS);
  const oldest = latest.at(-1);
  if (
    latest.length < RECENT_READINGS ||
    !oldest ||
    oldest.measuredAt <= since
  ) {
    return latest.reverse();
  }
  const window = await prisma.measurement.findMany({
    where: { userId, type, deletedAt: null, measuredAt: { gte: since } },
    orderBy: { measuredAt: "desc" },
    take: DENSE_READ_CAP,
    select: { value: true, measuredAt: true },
  });
  if (window.length === DENSE_READ_CAP) {
    annotate({
      action: { name: "insights.recent-readings.capped" },
      meta: { type, cap: DENSE_READ_CAP },
    });
  }
  return window.reverse();
}

/**
 * The latest `perType` readings of every type in `types`, oldest first, for
 * the multi-metric overview. It read the newest 5 000 rows across all types
 * at once, so a dense stream (pulse every few minutes) filled the whole read
 * within days and every other type fell out of the overview. One index
 * descent per type now bounds each type on its own. The driving relation is
 * aliased `mt`, the way `readLatestEver` aliases it, so the i18n call-site
 * scanner does not read the SQL as a translation call.
 */
export async function readLatestReadingsPerType(
  userId: string,
  types: readonly MeasurementType[],
  perType: number = RECENT_READINGS,
): Promise<Array<RecentReading & { type: MeasurementType }>> {
  if (types.length === 0) return [];
  const rows = await prisma.$queryRaw<
    Array<{ type: MeasurementType; value: number; measured_at: Date }>
  >`
    SELECT mt."type" AS "type", x."value", x."measured_at"
    FROM unnest(${[...types]}::text[]) AS mt("type")
    CROSS JOIN LATERAL (
      SELECT m."value", m."measured_at"
      FROM measurements m
      WHERE m."user_id" = ${userId}
        AND m."type" = mt."type"::measurement_type
        AND m."deleted_at" IS NULL
      ORDER BY m."measured_at" DESC
      LIMIT ${perType}
    ) x
    ORDER BY x."measured_at" ASC
  `;
  return rows.map((r) => ({
    type: r.type,
    value: Number(r.value),
    measuredAt: new Date(r.measured_at),
  }));
}
