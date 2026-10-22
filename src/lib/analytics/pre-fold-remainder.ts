/**
 * The pre-fold remainder of the dashboard slice: per type, the all-time
 * figures of every reading older than the rollup fold window.
 *
 * The slice splices it into its per-type figures, so "all-time" means all time
 * on the rollup path too (empty for any account younger than the
 * window). It keeps one source per (type, day) the way the rollup half
 * and the live path do: without it, a vital recorded by two devices
 * counted both of them on every pre-fold day. Each source is folded per
 * day first (a hash aggregate, a few rows per day however dense the
 * stream), each day then keeps its ladder-canonical source, so the
 * sort never sees more than one row per source per day.
 * An hourly-mean type folds each source's day as the mean of its
 * hours' means (`wsum` / `wdays`, see `day-mean.ts`) and the days into
 * the remainder once each, the statistic the DAY rollup stores.
 *
 * It is a closed block: it aggregates only readings measured before
 * `foldSplit`, the start of a UTC day five years back, so a sync of newer
 * readings cannot change it. On a long history it was the slice's largest
 * statement (every reading older than five years, folded per source and day),
 * and the slice is rebuilt after every sync. It is cached under a closed-block
 * key (`closedBlockKeyPart`): a measurement write that reaches back before
 * `foldSplit`, and every write that does not say how far back it reached,
 * drops it; the split moves on at the next UTC day, which names a new key.
 * The TTL bounds an entry that a write in another process (a split worker)
 * cannot reach.
 */
import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { closedBlockKeyPart } from "@/lib/cache/invalidate";
import { caches, type ServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db";
import { dayWeightedRowsSql, foldMeanSql } from "@/lib/measurements/day-mean";

export type PreFoldRemainderRow = {
  type: string;
  count: number;
  days: number;
  min: number;
  max: number;
  mean: number;
};

/** A closed block's lifetime when no write reaches it. */
const PRE_FOLD_REMAINDER_TTL_MS = 15 * 60_000;

/** The remainder as a live read, uncached. */
export function readPreFoldRemainderLive(
  userId: string,
  foldSplit: Date,
  rankPerSource: string,
): Promise<PreFoldRemainderRow[]> {
  return prisma.$queryRaw<PreFoldRemainderRow[]>`
      WITH src AS (
        SELECT *
        FROM measurements m
        WHERE m."user_id" = ${userId}
          AND m."deleted_at" IS NULL
          AND m."measured_at" < ${foldSplit}
      ),
      per_source AS (
        SELECT
          m."type",
          m."source",
          date_trunc('day', m."measured_at") AS day,
          COUNT(*)::int                      AS cnt,
          SUM(m."value")::double precision   AS total,
          MIN(m."value")::double precision   AS min_value,
          MAX(m."value")::double precision   AS max_value,
          SUM(m."value" * m.day_weight)::double precision AS wsum,
          SUM(m.day_weight)::double precision             AS wdays
        FROM ${dayWeightedRowsSql("src", null, { bySource: true })} m
        GROUP BY m."type", m."source", 3
      ),
      canon AS (
        SELECT DISTINCT ON (p."type", p.day)
          p."type", p.cnt, p.total, p.min_value, p.max_value, p.wsum, p.wdays
        FROM per_source p
        ORDER BY p."type", p.day, (${Prisma.raw(rankPerSource)}), p."source"::text
      )
      SELECT
        c."type"::text                                  AS type,
        SUM(c.cnt)::int                                 AS count,
        COUNT(*)::int                                   AS days,
        MIN(c.min_value)::double precision              AS min,
        MAX(c.max_value)::double precision              AS max,
        ${Prisma.raw(
          foldMeanSql({
            typeColumn: 'c."type"',
            total: "c.total",
            count: "c.cnt",
            weightedSum: "c.wsum",
            weightSum: "c.wdays",
          }),
        )}::double precision                            AS mean
      FROM canon c
      GROUP BY c."type"
`;
}

/**
 * The remainder through its closed-block cache cell. `rankPerSource` is the
 * ladder CASE over `p."type"` / `p."source"`, built from `priorityJson`,
 * which names the cell.
 */
export async function readPreFoldRemainder(
  userId: string,
  foldSplit: Date,
  priorityJson: unknown,
  rankPerSource: string,
): Promise<PreFoldRemainderRow[]> {
  const ladder = createHash("sha256")
    .update(JSON.stringify(priorityJson ?? null))
    .digest("base64url")
    .slice(0, 16);
  const cache = caches.analytics as ServerCache<PreFoldRemainderRow[]>;
  const { value } = await cache.wrap(
    `${userId}|pre-fold-remainder|${closedBlockKeyPart(foldSplit)}|${ladder}`,
    () => readPreFoldRemainderLive(userId, foldSplit, rankPerSource),
    PRE_FOLD_REMAINDER_TTL_MS,
  );
  return value;
}
