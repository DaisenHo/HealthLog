/**
 * The one place that turns readings into a day value and a window mean for the
 * types in `HOURLY_MEAN_DAY_TYPES` (see `day-statistic.ts`).
 *
 * For such a type a day is the weighted mean of its hours' means and a
 * window of days the mean of its day values, each day weighing one. How an
 * hour weighs is the pulse day-mean method (`day-statistic.ts`): one under
 * `hour_mean_v1`, `min(1, n / 3)` for an hour of `n` readings under
 * `weighted_hour_mean_v2`. Every helper applies this process's active method
 * unless the caller names one. Count, min and max stay over every reading.
 * Every other type keeps the plain mean over its readings, computed exactly as
 * before.
 *
 * "Day" and "hour" are the reader's own frame: a reader that buckets by the
 * user's local day passes that zone, a reader that buckets by the session's
 * (UTC) day passes `SESSION_DAY_FRAME`. The hours are always the hours of
 * that same frame, so a day never splits an hour.
 *
 * Two shapes are offered, one per kind of reader:
 *
 *   - TypeScript, for readers that hold the readings in memory:
 *     `readingsMean`, `dayValue` and `dayValueRows`, and `combineHourCells`
 *     for a reader that already holds per-hour sums.
 *   - SQL, for readers that aggregate in Postgres: `dayWeightedRows` attaches
 *     a `day_weight` to every reading (its hour's weight shared among the
 *     hour's readings, over the day's total hour weight, for an hourly-mean
 *     type; 1 otherwise), so a day's weights add up to one and
 *     `SUM(value * day_weight) / SUM(day_weight)` is the mean of the day
 *     values over any window. `windowMeanSql` and `foldMeanSql` build the mean
 *     expressions, falling back to the unchanged plain mean for every other
 *     type. A reader that groups by hour itself weighs its hours with
 *     `hourWeightSql` (or `storedHourWeightSql`) and `weightedHourMeanSql`.
 *
 * Type lists are closed code constants checked against an enum-shaped regex
 * before they are spliced; every value (user id, zone, bounds) stays a bound
 * parameter of the caller's query.
 */
import { Prisma } from "@/generated/prisma/client";
import { tzOffsetMinutes } from "@/lib/tz/format";

import {
  activePulseDayMeanMethod,
  HOURLY_MEAN_DAY_TYPES,
  hourWeight,
  type PulseDayMeanMethod,
  SPARSE_HOUR_FULL_WEIGHT,
  usesHourlyMeanDay,
} from "./day-statistic";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
/** Zone offsets change on quarter hours at the finest, so a quarter-hour slot shares one offset. */
const OFFSET_SLOT_MS = 15 * MS_PER_MINUTE;

export interface DayReading {
  value: number;
  measuredAt: Date;
}

// ─── TypeScript ───────────────────────────────────────────

/** Local wall-clock milliseconds of an instant, with a per-call offset cache. */
function makeLocalMs(tz: string): (at: Date) => number {
  const offsets = new Map<number, number>();
  return (at: Date) => {
    const t = at.getTime();
    const slot = Math.floor(t / OFFSET_SLOT_MS);
    let offset = offsets.get(slot);
    if (offset === undefined) {
      offset = tzOffsetMinutes(at, tz);
      offsets.set(slot, offset);
    }
    return t + offset * MS_PER_MINUTE;
  };
}

function plainMean(rows: readonly DayReading[]): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((s, r) => s + r.value, 0) / rows.length;
}

/**
 * A day value from its hours' reading sums and counts: the mean of the hours'
 * means, each hour weighed by `hourWeight` under `method`. `null` when no hour
 * holds a reading. The one TypeScript place the weighting lives; a reader
 * that already holds per-hour sums (`daily-stats.ts`) calls it directly.
 */
export function combineHourCells(
  hours: Iterable<{ sum: number; n: number }>,
  method: PulseDayMeanMethod = activePulseDayMeanMethod(),
): number | null {
  let weighted = 0;
  let weights = 0;
  for (const h of hours) {
    if (h.n <= 0) continue;
    const w = hourWeight(h.n, method);
    weighted += w * (h.sum / h.n);
    weights += w;
  }
  return weights > 0 ? weighted / weights : null;
}

/** The weighted mean of the per-hour means of readings that share one day. */
function meanOfHourMeans(
  rows: readonly DayReading[],
  localMs: (at: Date) => number,
  method: PulseDayMeanMethod,
): number {
  const hours = new Map<number, { sum: number; n: number }>();
  for (const r of rows) {
    const hour = Math.floor(localMs(r.measuredAt) / MS_PER_HOUR);
    const acc = hours.get(hour);
    if (acc) {
      acc.sum += r.value;
      acc.n += 1;
    } else {
      hours.set(hour, { sum: r.value, n: 1 });
    }
  }
  return combineHourCells(hours.values(), method) as number;
}

/** Group readings by local day (days since the epoch in `tz`). */
function groupByLocalDay<T extends DayReading>(
  rows: readonly T[],
  localMs: (at: Date) => number,
): Map<number, T[]> {
  const days = new Map<number, T[]>();
  for (const r of rows) {
    const day = Math.floor(localMs(r.measuredAt) / MS_PER_DAY);
    const list = days.get(day);
    if (list) list.push(r);
    else days.set(day, [r]);
  }
  return days;
}

/**
 * The value of ONE day's readings: the mean of its local hours' means for an
 * hourly-mean type, the plain mean otherwise. `null` for no readings.
 */
export function dayValue(
  type: string,
  rows: readonly DayReading[],
  tz: string,
  method: PulseDayMeanMethod = activePulseDayMeanMethod(),
): number | null {
  if (rows.length === 0) return null;
  if (!usesHourlyMeanDay(type)) return plainMean(rows);
  return meanOfHourMeans(rows, makeLocalMs(tz), method);
}

/**
 * The mean of a window of readings: for an hourly-mean type the mean of its
 * local days' values (each day the mean of its hours' means), otherwise the
 * plain mean over every reading, summed left to right as the readers always
 * did. `null` for no readings.
 */
export function readingsMean(
  type: string,
  rows: readonly DayReading[],
  tz: string,
  method: PulseDayMeanMethod = activePulseDayMeanMethod(),
): number | null {
  if (rows.length === 0) return null;
  if (!usesHourlyMeanDay(type)) return plainMean(rows);
  const localMs = makeLocalMs(tz);
  let sum = 0;
  let days = 0;
  for (const dayRows of groupByLocalDay(rows, localMs).values()) {
    sum += meanOfHourMeans(dayRows, localMs, method);
    days += 1;
  }
  return sum / days;
}

/**
 * Readings of an hourly-mean type replaced by one row per local day carrying
 * the day value, stamped at the day's first reading; a reader that folds rows
 * into a window by plain mean then weighs every day once. Every other type
 * comes back untouched (the same array).
 */
export function dayValueRows<T extends DayReading>(
  type: string,
  rows: readonly T[],
  tz: string,
  method: PulseDayMeanMethod = activePulseDayMeanMethod(),
): readonly DayReading[] {
  if (!usesHourlyMeanDay(type) || rows.length === 0) return rows;
  const localMs = makeLocalMs(tz);
  const out: DayReading[] = [];
  for (const dayRows of groupByLocalDay(rows, localMs).values()) {
    let first = dayRows[0].measuredAt;
    for (const r of dayRows) if (r.measuredAt < first) first = r.measuredAt;
    out.push({
      value: meanOfHourMeans(dayRows, localMs, method),
      measuredAt: first,
    });
  }
  return out.sort((a, b) => a.measuredAt.getTime() - b.measuredAt.getTime());
}

// ─── SQL ──────────────────────────────────────────────────

const ENUM_RE = /^[A-Z0-9_]+$/;

/** `'PULSE'` — the hourly-mean types as a spliceable text-literal list. */
export function hourlyMeanTypeLiterals(): string {
  return [...HOURLY_MEAN_DAY_TYPES]
    .map((t) => {
      if (!ENUM_RE.test(t)) {
        throw new Error(`unsafe enum literal for SQL splice: ${t}`);
      }
      return `'${t}'`;
    })
    .join(",");
}

/** SQL predicate: the type column names an hourly-mean type. */
export function isHourlyMeanTypeSql(typeColumn: string): string {
  return `(${typeColumn})::text IN (${hourlyMeanTypeLiterals()})`;
}

/**
 * The frame a reader buckets its days in. `SESSION_DAY_FRAME` is
 * `date_trunc('day', measured_at)` on the timestamptz itself, the frame of the
 * rollup tier and of every reader that groups by that expression. A zone frame
 * names a bound parameter (`$3`) or a Prisma placeholder carrying an IANA zone.
 */
export type DayFrame = { kind: "session" } | { kind: "zone"; tzSql: string };

export const SESSION_DAY_FRAME: DayFrame = { kind: "session" };

/** A zone frame whose zone is the caller's bound parameter `tzSql` (e.g. `$3`). */
export function zoneDayFrame(tzSql: string): DayFrame {
  if (!/^\$\d+$/.test(tzSql) && tzSql !== "'UTC'") {
    throw new Error(`zone frame must be a bound parameter: ${tzSql}`);
  }
  return { kind: "zone", tzSql };
}

function frameTs(frame: DayFrame, column: string): string {
  return frame.kind === "session"
    ? column
    : `((${column} AT TIME ZONE 'UTC') AT TIME ZONE ${frame.tzSql})`;
}

/** A column or expression of the caller's own query, never input. */
const SQL_EXPR_RE = /^[A-Za-z0-9_."() ]+$/;

/**
 * SQL weight of an hour holding `n` readings under `method` (see
 * `hourWeight`): `1.0` for `hour_mean_v1`, `LEAST(1, n / 3)` for
 * `weighted_hour_mean_v2`. `n` is a column of the caller's query.
 */
export function hourWeightSql(
  n: string,
  method: PulseDayMeanMethod = activePulseDayMeanMethod(),
): string {
  if (!SQL_EXPR_RE.test(n)) {
    throw new Error(`hour count must be a column expression: ${n}`);
  }
  return method === "weighted_hour_mean_v2"
    ? `LEAST(1.0, (${n})::double precision / ${SPARSE_HOUR_FULL_WEIGHT}.0)`
    : "1.0";
}

/**
 * `hourWeightSql` under the method stored in `app_settings`, read inside the
 * statement itself. For a writer whose output persists (the rollup tier): it
 * must follow the setting the moment the apply step changes it, not this
 * process's mirror of it, which trails by up to a minute.
 */
export function storedHourWeightSql(n: string): string {
  return `(CASE WHEN (SELECT st."pulse_day_mean_method" FROM "app_settings" st WHERE st."id" = 'singleton') = 'weighted_hour_mean_v2'
      THEN ${hourWeightSql(n, "weighted_hour_mean_v2")}
      ELSE 1.0 END)`;
}

/**
 * Aggregate over per-hour rows: the day value as the weighted mean of the
 * hours' means, `SUM(hourMean * weight) / SUM(weight)`. `weight` comes from
 * `hourWeightSql` or `storedHourWeightSql`.
 */
export function weightedHourMeanSql(hourMean: string, weight: string): string {
  if (!SQL_EXPR_RE.test(hourMean)) {
    throw new Error(`hour mean must be a column expression: ${hourMean}`);
  }
  return `(SUM((${hourMean}) * ${weight}) / NULLIF(SUM(${weight}), 0))`;
}

function weightedRowsSql(
  source: string,
  frame: DayFrame,
  bySource: boolean,
  method: PulseDayMeanMethod,
): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(source)) {
    throw new Error(`source must be a CTE name: ${source}`);
  }
  // One scan of the CTE and window functions only. The earlier shape joined
  // the CTE to an hour grouping of itself; with stale or missing statistics
  // (a fresh import below the autoanalyze threshold) the planner ran that
  // join as a nested loop and a year of pulse ran into the statement timeout.
  //
  // `dm_hour_n` counts the readings in a row's hour and `dm_hour_first` marks
  // one row per hour, so the sum of `dm_hour_first * w` over a day is the
  // day's total hour weight (its hour count under `hour_mean_v1`). A row's
  // weight is its hour's weight shared among the hour's readings, divided by
  // that total, so a day's weights still add up to one. Both columns ride
  // along on the row; every caller aggregates.
  const partition = (alias: string, unit: "hour" | "day") => {
    const keys = bySource
      ? `${alias}."type", ${alias}."source"`
      : `${alias}."type"`;
    const ts = frameTs(frame, `${alias}."measured_at"`);
    return `PARTITION BY ${keys}, date_trunc('${unit}', ${ts})`;
  };
  return `(
      SELECT s.*,
        (CASE WHEN ${isHourlyMeanTypeSql('s."type"')}
              THEN ${hourWeightSql("s.dm_hour_n", method)} / (s.dm_hour_n * SUM(s.dm_hour_first * ${hourWeightSql("s.dm_hour_n", method)}) OVER (${partition("s", "day")}))
              ELSE 1.0 END)::double precision AS day_weight
      FROM (
        SELECT t.*,
               COUNT(*) OVER (${partition("t", "hour")}) AS dm_hour_n,
               (ROW_NUMBER() OVER (${partition("t", "hour")}) = 1)::int AS dm_hour_first
        FROM ${source} t
      ) s
    )`;
}

/**
 * A subquery over the CTE `source` (which must expose `type`, `measured_at`
 * and, with `bySource`, `source`) that adds `day_weight` to every row. Alias
 * it at the call site: `FROM ${dayWeightedRows("cm", frame)} m`.
 *
 * `bySource` keys the hours per source, for a reader that folds each source's
 * days before it picks one; a reader over one canonical source per day leaves
 * it off.
 */
export function dayWeightedRows(
  source: string,
  frame: DayFrame,
  opts: { bySource?: boolean; method?: PulseDayMeanMethod } = {},
): string {
  return weightedRowsSql(
    source,
    frame,
    opts.bySource === true,
    opts.method ?? activePulseDayMeanMethod(),
  );
}

/**
 * The Prisma tagged-template twin of `dayWeightedRows`, for readers written
 * with `prisma.$queryRaw`: the zone, when given, is a bound parameter.
 */
export function dayWeightedRowsSql(
  source: string,
  tz: string | null,
  opts: { bySource?: boolean; method?: PulseDayMeanMethod } = {},
): Prisma.Sql {
  const method = opts.method ?? activePulseDayMeanMethod();
  if (tz === null) {
    return Prisma.raw(
      weightedRowsSql(
        source,
        SESSION_DAY_FRAME,
        opts.bySource === true,
        method,
      ),
    );
  }
  // Split around a placeholder so the zone binds as a parameter.
  const marker = "__DAY_MEAN_TZ__";
  const pieces = weightedRowsSql(
    source,
    { kind: "zone", tzSql: marker },
    opts.bySource === true,
    method,
  ).split(marker);
  let sql = Prisma.raw(pieces[0]);
  for (const piece of pieces.slice(1)) {
    sql = Prisma.sql`${sql}${tz}${Prisma.raw(piece)}`;
  }
  return sql;
}

/**
 * Window mean over weighted rows (`dayWeightedRows`): the mean of the day
 * values for an hourly-mean type, the unchanged `AVG(value)` otherwise. The
 * query groups by the type column (or filters to one type). `filter` is an
 * optional SQL predicate applied as an aggregate FILTER.
 */
export function windowMeanSql(opts: {
  typeColumn: string;
  value: string;
  weight: string;
  filter?: string;
}): string {
  const f = opts.filter ? ` FILTER (WHERE ${opts.filter})` : "";
  return `(CASE WHEN ${isHourlyMeanTypeSql(opts.typeColumn)}
      THEN SUM(${opts.value} * ${opts.weight})${f} / NULLIF(SUM(${opts.weight})${f}, 0)
      ELSE AVG(${opts.value})${f} END)`;
}

/**
 * Fold of per-day rows into a window mean: `SUM(wsum) / SUM(wdays)` (each day
 * once) for an hourly-mean type, the unchanged `SUM(total) / SUM(cnt)`
 * otherwise. `wsum` / `wdays` are `SUM(value * day_weight)` /
 * `SUM(day_weight)` per day.
 */
export function foldMeanSql(opts: {
  typeColumn: string;
  total: string;
  count: string;
  weightedSum: string;
  weightSum: string;
}): string {
  return `(CASE WHEN ${isHourlyMeanTypeSql(opts.typeColumn)}
      THEN SUM(${opts.weightedSum}) / NULLIF(SUM(${opts.weightSum}), 0)
      ELSE SUM(${opts.total}) / SUM(${opts.count}) END)`;
}
