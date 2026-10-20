/**
 * Quiet, deterministic observations about days (v1.42, #613).
 *
 * The rules describe and never interpret. "Highest daily value since
 * 3 March 2025" is a fact the record proves; "because of the new dose" is a
 * claim it cannot, and nothing here makes one. Each observation is a key
 * with parameters; the wording lives in the message bundles. They are shown
 * only where a person already looks (the dots under a chart, one line in the
 * day, the list before the next visit) and never pushed.
 *
 *   - **extremeHigh / extremeLow**: the day's value of a core type is the
 *     highest (lowest) for at least {@link EXTREME_MIN_SPAN_DAYS} days, with
 *     at least {@link EXTREME_MIN_HISTORY_DAYS} days of history before it.
 *     `since` is the last earlier day that was at least as high (low), or the
 *     first day the comparison saw. Either way the sentence is true.
 *   - **firstValue**: the first reading of a type the record holds.
 *   - **gap**: a type that came on at least {@link GAP_MIN_ACTIVE_DAYS} of
 *     the {@link GAP_LEAD_DAYS} days before and then stopped for at least
 *     {@link GAP_MIN_DAYS} days. Only in the visit preparation, where a gap
 *     is useful to know about, and never in the day itself.
 *
 * Only core types are compared for extremes: the vitals the dashboard is
 * built around. A watch's background figures would mark a day every week.
 * Pulse is left to the resting heart rate: its day value is a mean over
 * thousands of background samples, which says little as an extreme and
 * costs a scan of every one of them over two years.
 */
import { createHash } from "node:crypto";

import type { MeasurementType } from "@/generated/prisma/enums";

import type { DayNotable } from "@/lib/day/contract";
import { readLocalDailyStats, type DailyStats } from "@/lib/day/daily-stats";
import { caches, type ServerCache } from "@/lib/cache/server-cache";
import { prisma } from "@/lib/db";
import { startOfLocalDayKey } from "@/lib/tz/local-day";
import { daysBetweenDateKeys, shiftDateKey, userDayKey } from "@/lib/tz/format";

/** The types extremes are computed for. */
export const NOTABLE_EXTREME_TYPES: readonly MeasurementType[] = [
  "WEIGHT",
  "BLOOD_PRESSURE_SYS",
  "BLOOD_PRESSURE_DIA",
  "RESTING_HEART_RATE",
  "BLOOD_GLUCOSE",
  "HEART_RATE_VARIABILITY",
];

/** Days of history an extreme needs before it is called one. */
export const EXTREME_MIN_HISTORY_DAYS = 30;
/** How long a value has to stand unmatched to be an extreme. */
export const EXTREME_MIN_SPAN_DAYS = 90;
/** How far back the comparison looks. */
export const NOTABLE_LOOKBACK_DAYS = 730;
/** A gap is at least this many days without the type. */
export const GAP_MIN_DAYS = 14;
/** The days before a gap that show the type was a habit. */
export const GAP_LEAD_DAYS = 28;
/** Three readings a week over {@link GAP_LEAD_DAYS}. */
export const GAP_MIN_ACTIVE_DAYS = 12;

/** One observation, dated. */
export interface DatedNotable extends DayNotable {
  date: string;
}

function tidy(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Extremes in one type's daily series, for the days from `from` on. The
 * series is ascending by day and may start well before `from`; that part is
 * history only. Linear: a stack of the earlier days not yet outdone gives
 * each day the last earlier day at least as high (or as low).
 */
export function extremesInSeries(
  type: MeasurementType,
  series: ReadonlyArray<readonly [string, number]>,
  from: string,
): DatedNotable[] {
  const out: DatedNotable[] = [];
  if (series.length === 0) return out;
  const first = series[0][0];
  const highs: number[] = [];
  const lows: number[] = [];
  series.forEach(([day, value], i) => {
    while (highs.length > 0 && series[highs[highs.length - 1]][1] < value) {
      highs.pop();
    }
    while (lows.length > 0 && series[lows[lows.length - 1]][1] > value) {
      lows.pop();
    }
    if (day >= from && i >= EXTREME_MIN_HISTORY_DAYS) {
      const high =
        highs.length > 0 ? series[highs[highs.length - 1]][0] : first;
      const low = lows.length > 0 ? series[lows[lows.length - 1]][0] : first;
      if (daysBetweenDateKeys(high, day) >= EXTREME_MIN_SPAN_DAYS) {
        out.push({
          date: day,
          kind: "extremeHigh",
          type,
          params: { since: high, value: tidy(value) },
        });
      } else if (daysBetweenDateKeys(low, day) >= EXTREME_MIN_SPAN_DAYS) {
        out.push({
          date: day,
          kind: "extremeLow",
          type,
          params: { since: low, value: tidy(value) },
        });
      }
    }
    highs.push(i);
    lows.push(i);
  });
  return out;
}

/**
 * Gaps in one type over `[from, to]`, dated on the first missing day. A gap
 * still open at `to` counts the days up to `to`.
 */
export function gapsInSeries(
  type: MeasurementType,
  days: ReadonlySet<string>,
  from: string,
  to: string,
): DatedNotable[] {
  const out: DatedNotable[] = [];
  let runStart: string | null = null;
  const close = (end: string) => {
    if (runStart === null) return;
    const length = daysBetweenDateKeys(runStart, end) + 1;
    if (length >= GAP_MIN_DAYS && wasHabit(days, runStart)) {
      out.push({ date: runStart, kind: "gap", type, params: { days: length } });
    }
    runStart = null;
  };
  for (let day = from; day <= to; day = shiftDateKey(day, 1)) {
    if (days.has(day)) close(shiftDateKey(day, -1));
    else if (runStart === null) runStart = day;
  }
  close(to);
  return out;
}

function wasHabit(days: ReadonlySet<string>, gapStart: string): boolean {
  let active = 0;
  for (let i = 1; i <= GAP_LEAD_DAYS; i += 1) {
    if (days.has(shiftDateKey(gapStart, -i))) active += 1;
  }
  return active >= GAP_MIN_ACTIVE_DAYS;
}

/** A type's daily series as ascending `[day, value]` pairs. */
function seriesOf(
  stats: DailyStats,
  type: MeasurementType,
): Array<[string, number]> {
  return [...(stats.get(type) ?? new Map<string, number>()).entries()].sort(
    (a, b) => a[0].localeCompare(b[0]),
  );
}

/**
 * The first live reading of each type, as an instant. One index probe per
 * type on `measurements_live_covering_idx`.
 */
export async function readFirstReadings(
  userId: string,
  types: readonly MeasurementType[],
): Promise<Map<MeasurementType, Date>> {
  const out = new Map<MeasurementType, Date>();
  if (types.length === 0) return out;
  const rows = await prisma.$queryRaw<
    Array<{ type: MeasurementType; first: Date | null }>
  >`
    SELECT wanted."type"::text AS "type",
      (SELECT m."measured_at" FROM "measurements" m
        WHERE m."user_id" = ${userId} AND m."type" = wanted."type"
          AND m."deleted_at" IS NULL
        ORDER BY m."measured_at" ASC LIMIT 1) AS "first"
    FROM unnest(${[...types]}::"measurement_type"[]) AS wanted("type")
  `;
  for (const row of rows) if (row.first) out.set(row.type, row.first);
  return out;
}

/**
 * The history is cached in fixed blocks of local days counted from the
 * epoch, so neighbouring days share them and a block's size never grows.
 */
const HISTORY_BLOCK_DAYS = 90;
const HISTORY_EPOCH = "1970-01-01";
/** Measurement writes sweep the cells; the TTL only bounds an idle one. */
const HISTORY_TTL_MS = 15 * 60_000;

/** The first day of the block holding `day`. */
function blockStartOf(day: string): string {
  const offset = daysBetweenDateKeys(HISTORY_EPOCH, day);
  return shiftDateKey(
    HISTORY_EPOCH,
    Math.floor(offset / HISTORY_BLOCK_DAYS) * HISTORY_BLOCK_DAYS,
  );
}

/**
 * The daily series behind the extremes, for the local days `[from, to]`.
 *
 * Every day view compares its day with the two years before it, so paging
 * from one day to the next read the same two years again. The history is
 * cached per record, zone, source ladder and readable type set in blocks of
 * {@link HISTORY_BLOCK_DAYS} days, and a window is put together from the
 * blocks it touches: a day's value does not depend on the window around it,
 * so a slice cut at local day keys is exactly what the live read would see.
 * A block that ends before today is the same whatever day it is read on; the
 * block holding today ends at today and carries today in its key. Each cell
 * therefore holds at most one block of days per type, paging back reuses the
 * blocks it already has instead of caching a near-full copy of the two years
 * per block boundary, and a cold day long ago reads its own two years, not
 * everything from there to today. The blocks a window misses are read in one
 * query. A type the record's modules switch off is never read. A lookback
 * floor inside the window, or a window that reaches past today, reads live.
 */
async function readExtremeHistory(args: {
  userId: string;
  readable: readonly MeasurementType[];
  from: string;
  to: string;
  tz: string;
  priorityJson: unknown;
  floor: Date | null;
}): Promise<DailyStats> {
  const fromInstant = startOfLocalDayKey(args.from, args.tz);
  const today = userDayKey(new Date(), args.tz);
  const read = (from: Date, lastDay: string) =>
    readLocalDailyStats({
      userId: args.userId,
      types: args.readable,
      from,
      to: startOfLocalDayKey(shiftDateKey(lastDay, 1), args.tz),
      tz: args.tz,
      priorityJson: args.priorityJson,
    });
  if (args.floor && args.floor > fromInstant) return read(args.floor, args.to);
  if (args.to > today) return read(fromInstant, args.to);

  const ladder = createHash("sha256")
    .update(JSON.stringify(args.priorityJson ?? null))
    .digest("base64url")
    .slice(0, 16);
  const prefix = [
    args.userId,
    "notable-history",
    args.tz,
    ladder,
    [...args.readable].sort().join(","),
  ].join("|");
  const cache = caches.analytics as ServerCache<DailyStats>;

  const blocks: Array<{ start: string; end: string; key: string }> = [];
  for (
    let start = blockStartOf(args.from);
    start <= args.to;
    start = shiftDateKey(start, HISTORY_BLOCK_DAYS)
  ) {
    const last = shiftDateKey(start, HISTORY_BLOCK_DAYS - 1);
    const open = last >= today;
    blocks.push({
      start,
      end: open ? today : last,
      key: `${prefix}|${start}|${open ? today : "closed"}`,
    });
  }

  const found = new Map<string, DailyStats>();
  const missing = blocks.filter((block) => {
    const hit = cache.get(block.key);
    if (hit) found.set(block.key, hit);
    return !hit;
  });
  if (missing.length > 0) {
    const first = missing[0]!;
    const last = missing[missing.length - 1]!;
    const stats = await read(
      startOfLocalDayKey(first.start, args.tz),
      last.end,
    );
    for (const block of blocks) {
      if (block.start < first.start || block.end > last.end) continue;
      const cell = sliceDays(stats, block.start, block.end);
      cache.set(block.key, cell, HISTORY_TTL_MS);
      found.set(block.key, cell);
    }
  }

  const out: DailyStats = new Map();
  for (const block of blocks) {
    for (const [type, days] of found.get(block.key) ?? new Map()) {
      const into = out.get(type) ?? new Map<string, number>();
      for (const [day, value] of days) {
        if (day >= args.from && day <= args.to) into.set(day, value);
      }
      out.set(type, into);
    }
  }
  return out;
}

/** The days of `stats` inside `[from, to]`, a copy. */
function sliceDays(stats: DailyStats, from: string, to: string): DailyStats {
  const out: DailyStats = new Map();
  for (const [type, days] of stats) {
    const kept = new Map<string, number>();
    for (const [day, value] of days) {
      if (day >= from && day <= to) kept.set(day, value);
    }
    out.set(type, kept);
  }
  return out;
}

/**
 * The observations for a window of local days `[from, to]`.
 *
 * `typeVisible` is the module mask; a switched-off type is never read.
 * `floor` keeps the comparison inside a reader's lookback limit.
 */
export async function loadNotableRange(args: {
  userId: string;
  from: string;
  to: string;
  tz: string;
  priorityJson: unknown;
  typeVisible: (type: MeasurementType) => boolean;
  /** Whether to report gaps (the visit preparation only). */
  gaps: boolean;
  /** Narrow the extreme types further (the day passes the types it holds). */
  extremeTypes?: readonly MeasurementType[];
  /** Types to report first readings for (the extreme types by default). */
  firstValueTypes?: readonly MeasurementType[];
  floor?: Date | null;
}): Promise<DatedNotable[]> {
  const wanted = args.extremeTypes
    ? new Set<MeasurementType>(args.extremeTypes)
    : null;
  const types = NOTABLE_EXTREME_TYPES.filter(
    (t) => args.typeVisible(t) && (wanted === null || wanted.has(t)),
  );
  const firstTypes = (args.firstValueTypes ?? types).filter(args.typeVisible);
  const [stats, firsts] = await Promise.all([
    types.length === 0
      ? new Map()
      : readExtremeHistory({
          userId: args.userId,
          readable: NOTABLE_EXTREME_TYPES.filter(args.typeVisible),
          from: shiftDateKey(args.from, -NOTABLE_LOOKBACK_DAYS),
          to: args.to,
          tz: args.tz,
          priorityJson: args.priorityJson,
          floor: args.floor ?? null,
        }),
    readFirstReadings(args.userId, firstTypes),
  ]);

  const out: DatedNotable[] = [];
  for (const type of types) {
    const series = seriesOf(stats, type);
    out.push(
      ...extremesInSeries(type, series, args.from).filter(
        (n) => n.date <= args.to,
      ),
    );
    if (args.gaps) {
      out.push(
        ...gapsInSeries(
          type,
          new Set(series.map(([day]) => day)),
          args.from,
          args.to,
        ),
      );
    }
  }
  for (const [type, first] of firsts) {
    const day = userDayKey(first, args.tz);
    if (day >= args.from && day <= args.to) {
      out.push({ date: day, kind: "firstValue", type, params: { type } });
    }
  }
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.type ?? "").localeCompare(b.type ?? ""),
  );
}
