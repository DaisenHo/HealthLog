/**
 * Sleep nights read from Postgres, a page or a night at a time.
 *
 * Sleep is stored one row per stage, so a long history is a large row set:
 * every reader here keeps the stage rows that reach the process to the
 * nights it was asked about, and the reconstruction itself stays the one in
 * `sleep-night.ts`. The SQL below only decides which nights exist and where
 * their sessions lie; what a night holds is always the JS reconstruction's.
 */
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { MeasurementSource, SleepStage } from "@/generated/prisma/client";
import {
  ASLEEP_STAGES,
  SESSION_GAP_MS,
  reconstructSleepNights,
  reconstructSleepSessions,
  type SleepNight,
  type SleepSession,
} from "@/lib/analytics/sleep-night";
import { localDayWindow } from "@/lib/tz/local-day";
import { pageWithWindowTotal } from "./paging";

/** A stage row as every sleep reader selects it. */
export interface SleepRow {
  id: string;
  value: number;
  measuredAt: Date;
  sleepStage: SleepStage | null;
  source: MeasurementSource;
  deviceType: string | null;
}

/** The read bounds a list request passes through, both inclusive. */
export interface SleepReadBounds {
  from?: Date;
  to?: Date;
}

/**
 * How far a one-night read reaches either side of its day. Sessions split at
 * a three-hour gap, so a session ending on that day starts inside the reach
 * unless it lasted over a day and a half, and every session the cut
 * truncates ends on another day.
 */
export const NIGHT_READ_REACH_MS = 36 * 60 * 60 * 1000;

/**
 * The asleep stages as a SQL list. A whitelist splice: each value is asserted
 * against the closed enum shape before it is joined, so nothing from a
 * request can reach it, and the list is `ASLEEP_STAGES`, the very set the
 * JS reconstruction counts as asleep.
 */
const ASLEEP_STAGE_SQL = Prisma.raw(
  ASLEEP_STAGES.map((stage) => {
    if (!/^[A-Z_]+$/.test(stage)) throw new Error(`bad sleep stage ${stage}`);
    return `'${stage}'`;
  }).join(", "),
);

/**
 * Stage rows between two instants (inclusive), oldest first, narrowed by the
 * request's own bounds.
 */
export async function readSleepRows(
  userId: string,
  gte: Date,
  lte: Date,
  bounds: SleepReadBounds = {},
): Promise<SleepRow[]> {
  return prisma.measurement.findMany({
    where: {
      userId,
      type: "SLEEP_DURATION",
      deletedAt: null,
      AND: [
        { measuredAt: { gte, lte } },
        ...(bounds.from ? [{ measuredAt: { gte: bounds.from } }] : []),
        ...(bounds.to ? [{ measuredAt: { lte: bounds.to } }] : []),
      ],
    },
    orderBy: [{ measuredAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      value: true,
      measuredAt: true,
      sleepStage: true,
      source: true,
      // Writer-level collapse: two HealthKit apps behind one source (watch
      // stages vs phone in-bed) must not blend into one night.
      deviceType: true,
    },
  });
}

/**
 * The sessions of one wake day: the stage rows within `NIGHT_READ_REACH_MS`
 * of the day, reconstructed, and the sessions filed under it kept.
 */
export async function readNightSessions(
  userId: string,
  day: string,
  tz: string,
  priorityJson: unknown,
  bounds: SleepReadBounds = {},
): Promise<{ sessions: SleepSession[]; rows: SleepRow[] }> {
  const { dayStart, dayEnd } = localDayWindow(day, tz);
  const rows = await readSleepRows(
    userId,
    new Date(dayStart.getTime() - NIGHT_READ_REACH_MS),
    new Date(dayEnd.getTime() + NIGHT_READ_REACH_MS),
    bounds,
  );
  const sessions = reconstructSleepSessions(rows, tz, priorityJson).filter(
    (s) => s.night === day,
  );
  return { sessions, rows };
}

/**
 * The wake day of the most recent night that holds sleep, or null. Found
 * from the latest asleep row: the night holding it is the newest one, and
 * its sessions lie within the one-night reach of that row.
 */
export async function latestSleepNight(
  userId: string,
  tz: string,
  priorityJson: unknown,
): Promise<string | null> {
  const latest = await prisma.measurement.findFirst({
    where: {
      userId,
      type: "SLEEP_DURATION",
      deletedAt: null,
      value: { gt: 0 },
      OR: [{ sleepStage: null }, { sleepStage: { in: [...ASLEEP_STAGES] } }],
    },
    orderBy: { measuredAt: "desc" },
    select: { measuredAt: true },
  });
  if (!latest) return null;
  const at = latest.measuredAt.getTime();
  const rows = await readSleepRows(
    userId,
    new Date(at - NIGHT_READ_REACH_MS),
    new Date(at + NIGHT_READ_REACH_MS),
  );
  const scorable = reconstructSleepSessions(rows, tz, priorityJson).filter(
    (s) => s.asleepMinutes > 0,
  );
  return scorable.at(-1)?.night ?? null;
}

/** One night of a page: its wake day and the span its sessions cover. */
export interface SleepNightSpan {
  night: string;
  spanStart: Date;
  spanEnd: Date;
}

/**
 * One page of sleep nights, chosen in Postgres.
 *
 * The stage rows are cut into sessions the way `reconstructSleepSessions`
 * cuts them: ordered by start (`measured_at` minus the minutes), a new
 * session wherever a row starts more than `SESSION_GAP_MS` after every
 * earlier row has ended. A session counts when it holds an asleep row (an
 * `ASLEEP_STAGES` stage, or a stage-less row, with minutes), and its night is
 * the local day its last row ends on: the reconstruction's own rule, so a
 * page night and a reconstructed night name the same day. Nights are grouped,
 * sorted and cut by `limit` / `offset`; `total` counts the whole filtered set.
 * `spanStart` / `spanEnd` bound the night's counting sessions, so the caller
 * reads exactly their rows.
 *
 * Before the cut, rows are folded into hour buckets by their end: min start,
 * max end, any asleep. That cannot move a session boundary. Two rows whose
 * ends lie less than the session gap apart always share a session (the later
 * one starts before its own end, which is within the gap of the earlier end),
 * so a bucket narrower than the gap only ever holds rows of one session, and
 * its bounds are that group's bounds. It cuts the rows the window functions
 * sort from every stage to a handful per night.
 */
export async function sleepNightPage(
  userId: string,
  tz: string,
  opts: SleepReadBounds & {
    sortDir: "asc" | "desc";
    limit: number;
    offset: number;
  },
): Promise<{ nights: SleepNightSpan[]; total: number }> {
  const gapSeconds = SESSION_GAP_MS / 1000;
  // Direction comes from the Zod enum, never from raw input.
  const direction = Prisma.raw(opts.sortDir === "asc" ? "ASC" : "DESC");
  const nightsCte = Prisma.sql`
    WITH r AS (
      SELECT
        MIN(m."measured_at" - m."value" * interval '1 minute') AS s,
        MAX(m."measured_at") AS e,
        BOOL_OR(m."value" > 0 AND (m."sleep_stage" IS NULL
          OR m."sleep_stage" IN (${ASLEEP_STAGE_SQL}))) AS asleep
      FROM measurements m
      WHERE m."user_id" = ${userId}
        AND m."type" = 'SLEEP_DURATION'::measurement_type
        AND m."deleted_at" IS NULL
        ${opts.from ? Prisma.sql`AND m."measured_at" >= ${opts.from}` : Prisma.empty}
        ${opts.to ? Prisma.sql`AND m."measured_at" <= ${opts.to}` : Prisma.empty}
      GROUP BY date_bin(interval '1 hour', m."measured_at", TIMESTAMPTZ '2000-01-01 00:00:00+00')
    ), o AS (
      SELECT r.*, MAX(e) OVER (
        ORDER BY s, e ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ) AS prev_end
      FROM r
    ), g AS (
      SELECT o.*, SUM(
        CASE WHEN prev_end IS NULL
          OR s - prev_end > make_interval(secs => ${gapSeconds}::double precision) THEN 1 ELSE 0 END
      ) OVER (ORDER BY s, e ROWS UNBOUNDED PRECEDING) AS sid
      FROM o
    ), sess AS (
      SELECT MIN(s) AS s, MAX(e) AS e
      FROM g
      GROUP BY sid
      HAVING BOOL_OR(asleep)
    ), nights AS (
      SELECT
        to_char((e AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS night,
        MIN(s) AS span_start,
        MAX(e) AS span_end
      FROM sess
      GROUP BY 1
    )
  `;
  const { rows, total } = await pageWithWindowTotal(
    await prisma.$queryRaw<
      Array<{ night: string; span_start: Date; span_end: Date; total: number }>
    >`
      ${nightsCte}
      SELECT night, span_start, span_end, (COUNT(*) OVER ())::int AS total
      FROM nights
      ORDER BY night ${direction}
      LIMIT ${opts.limit} OFFSET ${opts.offset}
    `,
    opts.offset,
    async () =>
      Number(
        (
          await prisma.$queryRaw<Array<{ total: number }>>`
            ${nightsCte}
            SELECT COUNT(*)::int AS total FROM nights
          `
        )[0]?.total ?? 0,
      ),
  );
  return {
    nights: rows.map((r) => ({
      night: r.night,
      spanStart: r.span_start,
      spanEnd: r.span_end,
    })),
    total,
  };
}

/**
 * The stage rows of a set of page nights, read in one span. The nights are
 * consecutive in the sorted night set, so the span from the first one's start
 * to the last one's end holds their sessions whole; any other session in it
 * holds no sleep.
 */
export async function readNightSpanRows(
  userId: string,
  nights: readonly SleepNightSpan[],
  bounds: SleepReadBounds = {},
): Promise<SleepRow[]> {
  if (nights.length === 0) return [];
  let spanStart = nights[0].spanStart;
  let spanEnd = nights[0].spanEnd;
  for (const n of nights) {
    if (n.spanStart < spanStart) spanStart = n.spanStart;
    if (n.spanEnd > spanEnd) spanEnd = n.spanEnd;
  }
  return readSleepRows(userId, spanStart, spanEnd, bounds);
}

/** How many nights one chunked read reconstructs at a time. */
const NIGHT_CHUNK = 90;

/**
 * Every night in a window as `reconstructSleepNights` builds it, oldest
 * first, without holding the window's stage rows at once: Postgres names the
 * nights and their spans, and the rows are read and reconstructed ninety
 * nights at a time. Any window length costs a bounded heap, so a reader never
 * has to cut a long range short to stay safe. `maxNights` keeps the oldest
 * nights of the window, or with `newest` the most recent ones.
 */
export async function readSleepNights(
  userId: string,
  tz: string,
  priorityJson: unknown,
  bounds: SleepReadBounds & { maxNights: number; newest?: boolean },
): Promise<SleepNight[]> {
  const page = await sleepNightPage(userId, tz, {
    from: bounds.from,
    to: bounds.to,
    sortDir: bounds.newest ? "desc" : "asc",
    limit: bounds.maxNights,
    offset: 0,
  });
  const nights = bounds.newest ? page.nights.reverse() : page.nights;
  const out: SleepNight[] = [];
  for (let i = 0; i < nights.length; i += NIGHT_CHUNK) {
    const chunk = nights.slice(i, i + NIGHT_CHUNK);
    const keys = new Set(chunk.map((n) => n.night));
    const rows = await readNightSpanRows(userId, chunk, bounds);
    for (const night of reconstructSleepNights(rows, tz, priorityJson)) {
      if (keys.has(night.night)) out.push(night);
    }
  }
  return out;
}
