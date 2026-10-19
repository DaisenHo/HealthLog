import { prisma } from "@/lib/db";
import {
  apiHandler,
  isScopedCredential,
  requireRecordAuth,
} from "@/lib/api-handler";
import { EXTERNAL_SOURCE } from "@/lib/measurements/external-source";
import { MEASUREMENTS_WRITE_SCOPE } from "@/lib/measurements/scopes";
import { annotate } from "@/lib/logging/context";
import { fireAndForget } from "@/lib/logging/fire-and-forget";
import { auditLog } from "@/lib/auth/audit";
import {
  apiSuccess,
  apiError,
  getClientIp,
  returnAllZodIssues,
  safeJson,
  sanitiseZodIssues,
} from "@/lib/api-response";
import { checkRecordWriteRateLimit } from "@/lib/rate-limit";
import {
  createMeasurementSchema,
  createBatchMeasurementSchema,
  listMeasurementsSchema,
  getUnitForType,
} from "@/lib/validations/measurement";
import {
  BUCKET_CAP,
  type AggregateGrain,
} from "@/lib/measurements/range-aggregation";
import { CUMULATIVE_HK_TYPES } from "@/lib/measurements/apple-health-mapping";
import { metricKeyForType } from "@/lib/measurements/cumulative-day-sum";
import { pickCanonicalSourceRows } from "@/lib/analytics/source-priority";
import {
  canonicalDailyTimestamp,
  dayKeyForUserTz,
} from "@/lib/measurements/drain-per-sample-cumulative";
import { localDayWindow } from "@/lib/tz/local-day";
import { withIdempotency } from "@/lib/idempotency";
import { isP2002 } from "@/lib/prisma-errors";
import { encryptNote, shapeMeasurementNotes } from "@/lib/crypto/note-cipher";
import { invalidateUserMeasurements } from "@/lib/cache/invalidate";
import { emitInsertedMeasurementArrivals } from "@/lib/arrivals/measurement-emit";
import { maybeEnqueueMorningRefresh } from "@/lib/daily/morning-refresh-trigger";
import { enqueueReminderSatisfy } from "@/lib/jobs/reminder-satisfy";
import { runSafetyFloorCheck } from "@/lib/illness/safety-floor-check";
import { afterMeasurementMutation } from "@/lib/rollups/after-measurement-mutation";
import { loadUserSourcePriority } from "@/lib/rollups/measurement-read";
import {
  readDailySeries,
  readLiveBuckets,
} from "@/lib/measurements/daily-series-read";
import {
  reconstructSleepSessions,
  pickMainNightAndNaps,
  SESSION_GAP_MS,
} from "@/lib/analytics/sleep-night";
import { resolveUserTimezone } from "@/lib/tz/resolver";
import {
  isNamedSleepStageBody,
  sleepStageEntrySchema,
  toSleepStageSegment,
} from "@/lib/validations/sleep-stage-entry";
import {
  MeasurementReconciliationError,
  reconcileExternalMeasurement,
} from "@/lib/measurements/reconcile-external-measurement";
import {
  MEASURED_AT_TOLERANCE_MS,
  isMergeableSource,
  isSameReadingAcrossSource,
  oppositeMergeSource,
} from "@/lib/measurements/cross-source-merge";
import { NextRequest } from "next/server";
import {
  Prisma,
  type MeasurementType,
  type MeasurementSource,
  type GlucoseContext,
  type SleepStage,
} from "@/generated/prisma/client";
import { DEFAULT_TIMEZONE, isValidTimezone } from "@/lib/tz/format";

export const GET = apiHandler(async (request: NextRequest) => {
  const { user } = await requireRecordAuth("read", "measurements");

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = listMeasurementsSchema.safeParse(params);
  if (!parsed.success) {
    // v1.4.43 W6 — surface every Zod issue under `details.issues` so a
    // multi-field iOS query (chart loader bug, drill-down regression)
    // doesn't iterate one error per round-trip. Best-effort audit-
    // ledger breadcrumb keyed `measurements.list.validation-failed`.
    const issues = sanitiseZodIssues(parsed.error.issues);
    annotate({
      action: { name: "measurements.list.validation-failed" },
      meta: { issue_count: issues.length },
    });
    // v1.4.49 — strip `message` from the audit-ledger row to keep
    // any free-text query slice (custom `dayKey`, attacker-shaped
    // `type=`) out of the persisted breadcrumb.
    const auditIssues = sanitiseZodIssues(parsed.error.issues, {
      stripValuesFromMessage: true,
    });
    // v1.36.0 — through `auditLog()` rather than a bare `prisma.auditLog
    // .create`, because that helper is the only thing that stamps
    // `actorUserId`. Filed under the resolved record either way; without the
    // stamp a delegate's malformed query would read as the owner's own.
    void auditLog("measurements.list.validation-failed", {
      userId: user.id,
      details: { issues: auditIssues },
    }).catch(() => {
      /* swallow — 422 response is the contract */
    });
    return returnAllZodIssues(parsed.error, 422);
  }

  const {
    type,
    from,
    to,
    limit,
    offset,
    sortBy,
    sortDir,
    aggregate,
    source,
    sourceEq,
    valueMin,
    valueMax,
    groupBy,
    dayKey,
  } = parsed.data;

  const where = {
    userId: user.id,
    // v1.4.40 W-DELETED — soft-deleted readings are invisible to every
    // list / count / aggregate read. The dedicated `sync/state` route
    // keeps surfacing them via its own filter so iOS can reconcile
    // tombstones; every other consumer (list view, analytics fan-out,
    // dashboard read paths) must never include them.
    deletedAt: null,
    ...(type && { type: type as MeasurementType }),
    // v1.15.13 — management-list source filter. Distinct from the
    // `source=rollup` opt-in above (which selects the rollup read tier);
    // `sourceEq` narrows the plain list to one ingest source.
    ...(sourceEq && { source: sourceEq }),
    // v1.18.5 — value-range filter (backlog G). Open-ended on either side;
    // the validator has already rejected an inverted `valueMin > valueMax`.
    ...(valueMin != null || valueMax != null
      ? {
          value: {
            ...(valueMin != null && { gte: valueMin }),
            ...(valueMax != null && { lte: valueMax }),
          },
        }
      : {}),
    ...(from || to
      ? {
          measuredAt: {
            ...(from && { gte: from }),
            ...(to && { lte: to }),
          },
        }
      : {}),
  };

  // v1.11.5 — sleep is read row-per-STAGE (≈5 rows/night × source-count),
  // not a spot sample and not a cumulative day-sum. A plain list query for
  // SLEEP_DURATION would leak every stage segment as its own "value" — the
  // "many small numbers that stand for themselves" complaint. Route it
  // through the canonical per-night aggregation (the same helper the chart
  // series + dashboard tile use) so a sleep list returns one row per night
  // carrying the night's TIME ASLEEP, with a `dayKey` drill-down to that
  // night's stage segments. Storage is untouched; only the display
  // collapses. Runs ahead of the cumulative branches because sleep is in
  // neither CUMULATIVE_HK_TYPES nor the spot-sample set.
  if (type === "SLEEP_DURATION") {
    return sleepListResponse(user, {
      from,
      to,
      limit,
      offset,
      sortDir,
      dayKey,
    });
  }

  // v1.4.37 W7c — list-view drill-down to per-sample rows for a single
  // calendar day in the user's IANA timezone. Resolves the day's UTC
  // bounds against `User.timezone`, then runs a plain `findMany` so the
  // expandable list row shows every per-sample chunk the daily collapse
  // hid. Gated to cumulative HK types — the spot-sample types render
  // one-row-per-event already and have nothing to drill into.
  if (dayKey && type && CUMULATIVE_HK_TYPES.has(type as MeasurementType)) {
    const tz =
      user.timezone && user.timezone.length > 0
        ? user.timezone
        : DEFAULT_TIMEZONE;
    // Resolve `[dayStart, dayEnd)` for the requested calendar day in
    // the user's local zone. v1.4.37 W10 — `localDayWindow` honours
    // DST: the previous shape (`canonicalDailyTimestamp ± 12 h`)
    // silently leaked or hid one hour of samples on spring-forward
    // (23-h day) and fall-back (25-h day) by always spanning exactly
    // 24 h. Works for every IANA offset including sub-half-hour
    // zones (Asia/Kathmandu UTC+5:45, Pacific/Chatham UTC+12:45).
    const { dayStart, dayEnd } = localDayWindow(dayKey, tz);
    const samples = await prisma.measurement.findMany({
      where: {
        userId: user.id,
        type: type as MeasurementType,
        measuredAt: { gte: dayStart, lt: dayEnd },
        deletedAt: null,
      },
      // Same tiebreaker as the paged list. This one slices in memory rather
      // than with `skip`, so there is no page drift to prevent — but two
      // identical requests would still be free to render a tied block in
      // different orders, and a drill-down that reshuffles on refresh reads
      // as data changing.
      orderBy: [{ measuredAt: sortDir }, { id: sortDir }],
      // v1.4.38 — the 1000-row cap now lives on the validator (refine
      // on `(limit, dayKey)` returning 422 when a caller asks for
      // more). The route reads `limit` straight through because the
      // validator has already clamped it.
      take: limit,
    });
    annotate({
      action: { name: "measurement.list" },
      meta: { total: samples.length, type, dayKey, mode: "drill-down" },
    });
    return apiSuccess({
      measurements: samples,
      meta: { total: samples.length, limit, offset: 0, dayKey },
    });
  }

  // v1.4.37 W7c — collapsed "one row per day" mode for cumulative
  // types. The list page renders the day's SUM as a single synthesised
  // row with a `sampleCount` chevron that drills back into the
  // per-sample rows via the `dayKey=…` branch above. `limit` / `offset`
  // page over DAYS, not raw rows (#1245).
  if (
    groupBy === "day" &&
    type &&
    CUMULATIVE_HK_TYPES.has(type as MeasurementType)
  ) {
    return dayGroupedListResponse(user, {
      type: type as MeasurementType,
      limit,
      offset,
      sortDir,
      sourceEq,
      valueMin,
      valueMax,
      from,
      to,
    });
  }

  // v1.4.28 FB-D2 — server-side aggregation. Gated on an explicit
  // `aggregate` param so the iOS contract (raw `MeasurementWireDTO`
  // shape on `GET /api/measurements`) is byte-stable for any caller
  // that omits the new query parameter. The chart-data client opts
  // in; iOS does not.
  //
  // R4-CODE-C1 — `take` no longer applies BEFORE bucketising. The
  // aggregation runs in Postgres via `date_trunc`, the bucket cap is
  // applied AFTER, so a 1-year `aggregate=daily` window walks every
  // row in the window and returns up to 365 buckets per type instead
  // of truncating to the first N raw rows.
  //
  // SD-H1 — "All time" range semantics. When the chart's "All" tab
  // is active, the client passes `from` = the user's earliest
  // measurement (or a sentinel like 1970-01-01) plus `to` = now plus
  // `aggregate=monthly` (or `weekly` when full history < 2 years).
  // The route's response is bounded by the `BUCKET_CAP` ceiling per
  // grain (monthly: 24, weekly: 105, daily: 365) so a multi-decade
  // account never paints an unbounded series.
  // `source=rollup` + `aggregate=daily` — the chart's series read. Windows up
  // to the DAY cap fold live into the user's local days (#1026); wider
  // windows step up to the WEEK / MONTH / YEAR rollup tier. `type` is
  // mandatory so the response mirrors the per-type ask the chart makes.
  if (source === "rollup" && aggregate === "daily" && type && from && to) {
    // Shared with the batched series endpoint, so both read the same rows.
    const cap = Math.min(limit, BUCKET_CAP.daily);
    const priorityJson = await loadUserSourcePriority(user.id);
    const measurements = await readDailySeries({
      userId: user.id,
      type: type as MeasurementType,
      from,
      to,
      limit,
      priorityJson,
    });
    if (measurements.length > 0) {
      return apiSuccess({
        measurements,
        meta: {
          total: measurements.length,
          limit: cap,
          offset: 0,
          aggregate: "daily",
        },
      });
    }
    // An empty result means the window genuinely holds no rows. Fall
    // through to the shared live aggregate branch below to keep the
    // response shape identical for the truly-empty case.
  }

  if (aggregate && aggregate !== "raw" && from && to) {
    const grain: Exclude<AggregateGrain, "raw"> = aggregate;
    const cap = Math.min(limit, BUCKET_CAP[grain]);
    // Buckets are cut at the user's own calendar boundaries (#1026), the
    // same day the raw list and the chart's short range use. Cumulative
    // types SUM per bucket, every other type averages; overlapping sources
    // collapse to the ladder-canonical one first.
    const priorityJson = await loadUserSourcePriority(user.id);
    const measurements = await readLiveBuckets({
      userId: user.id,
      type: (type as MeasurementType | undefined) ?? null,
      from,
      to,
      cap,
      priorityJson,
      grain,
      timeZone: await resolveUserTimezone(user.id),
    });
    annotate({
      action: { name: "measurement.list" },
      meta: { total: measurements.length, type, aggregate: grain },
    });
    return apiSuccess({
      measurements,
      meta: {
        total: measurements.length,
        limit: cap,
        offset: 0,
        aggregate: grain,
      },
    });
  }

  const [measurements, total] = await Promise.all([
    prisma.measurement.findMany({
      where,
      // `{ id: sortDir }` is the tiebreaker, not decoration. `measuredAt`
      // is not unique here and ties are the normal case. Only the exact
      // tuple `(userId, type, measuredAt, source, sleepStage)` is unique,
      // so a tie survives across `type` (the `stats:<id>:YYYY-MM-DD`
      // daily-rollup convention puts every daily total at one instant),
      // across `source` (two writers landing on the same instant) and
      // across `sleepStage`. Without a unique secondary key Postgres is
      // free to order the tied block differently between the query for page
      // N and the query for page N+1, so a client paging its own history
      // silently gets one row twice and never gets another.
      orderBy: [{ [sortBy]: sortDir }, { id: sortDir }],
      take: limit,
      skip: offset,
    }),
    prisma.measurement.count({ where }),
  ]);

  annotate({ action: { name: "measurement.list" }, meta: { total, type } });

  return apiSuccess({
    // v1.23 — decrypt `notesEncrypted` onto `notes` and strip the ciphertext
    // before it leaves the server (iOS MeasurementWireDTO contract).
    measurements: measurements.map(shapeMeasurementNotes),
    meta: { total, limit, offset },
  });
});

/**
 * The day-grouped list for a cumulative type, paged over local days.
 *
 * Everything heavy runs in Postgres. The first query picks the page: the
 * distinct local days that hold a reading, sorted and cut by `limit` /
 * `offset`, each row carrying the distinct-day count of the whole filtered
 * set as `meta.total` from a window count. The second folds only the page's
 * days, one row per day, source, device and unit with its sum and sample
 * count, and the source ladder picks among those groups exactly as it would
 * among the raw rows (it keeps or drops whole source and device groups per
 * day, never single rows). So a page costs its own days whatever the length
 * of the history, every day is complete, and no raw row reaches the heap.
 *
 * Until v1.43.6 the branch read the newest `limit` raw rows (the web asked
 * for 5000), bucketed them and returned every bucket. A long history came
 * back as thousands of rows in one response, and every day older than the
 * 5000th raw row was missing with nothing to say so.
 *
 * A day exists for the page when any reading of the type falls on it; the
 * source collapse narrows a day's groups but never empties one, so the count
 * and the folded rows agree.
 */
async function dayGroupedListResponse(
  user: { id: string; timezone?: string | null },
  opts: {
    type: MeasurementType;
    limit: number;
    offset: number;
    sortDir: "asc" | "desc";
    sourceEq?: MeasurementSource;
    valueMin?: number;
    valueMax?: number;
    from?: Date;
    to?: Date;
  },
) {
  const { type, limit, offset, sortDir } = opts;
  const stored =
    user.timezone && user.timezone.length > 0
      ? user.timezone
      : DEFAULT_TIMEZONE;
  // A zone Postgres does not know would 500 the read; the drill-down cuts
  // days in the same zone, so both must agree on it.
  const tz = isValidTimezone(stored) ? stored : DEFAULT_TIMEZONE;

  // The request's filters, as SQL: the same ones the plain list applies.
  const filters = Prisma.sql`
    m."user_id" = ${user.id}
    AND m."type" = ${type}::measurement_type
    AND m."deleted_at" IS NULL
    ${opts.sourceEq ? Prisma.sql`AND m."source" = ${opts.sourceEq}::measurement_source` : Prisma.empty}
    ${opts.valueMin != null ? Prisma.sql`AND m."value" >= ${opts.valueMin}` : Prisma.empty}
    ${opts.valueMax != null ? Prisma.sql`AND m."value" <= ${opts.valueMax}` : Prisma.empty}
    ${opts.from ? Prisma.sql`AND m."measured_at" >= ${opts.from}` : Prisma.empty}
    ${opts.to ? Prisma.sql`AND m."measured_at" <= ${opts.to}` : Prisma.empty}
  `;
  const localDay = Prisma.sql`to_char((m."measured_at" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM-DD')`;
  // Direction comes from the Zod enum, never from raw input. The window
  // count runs before LIMIT, so every row of the page carries the
  // distinct-day total of the whole filtered set.
  const direction = Prisma.raw(sortDir === "asc" ? "ASC" : "DESC");
  const pageDays = await prisma.$queryRaw<
    Array<{ day_key: string; total: number }>
  >`
    SELECT d.day_key, (COUNT(*) OVER ())::int AS total
    FROM (
      SELECT ${localDay} AS day_key
      FROM measurements m
      WHERE ${filters}
      GROUP BY 1
    ) d
    ORDER BY d.day_key ${direction}
    LIMIT ${limit} OFFSET ${offset}
  `;
  // A page past the end has no row to carry the total; only then is it
  // counted on its own.
  const total =
    pageDays.length > 0
      ? Number(pageDays[0].total)
      : offset > 0
        ? Number(
            (
              await prisma.$queryRaw<Array<{ total: number }>>`
                SELECT COUNT(DISTINCT ${localDay})::int AS total
                FROM measurements m
                WHERE ${filters}
              `
            )[0]?.total ?? 0,
          )
        : 0;
  const dayKeys = pageDays.map((d) => d.day_key);

  // The page's days are consecutive in the sorted day set, so the span from
  // the first one's start to the last one's end holds exactly their rows.
  let groups: Array<{
    day_key: string;
    source: MeasurementSource;
    device_type: string | null;
    unit: string;
    total: number;
    n: number;
  }> = [];
  if (dayKeys.length > 0) {
    const sorted = [...dayKeys].sort();
    const spanStart = localDayWindow(sorted[0], tz).dayStart;
    const spanEnd = localDayWindow(sorted[sorted.length - 1], tz).dayEnd;
    // Newest group first within a day, so the day's label comes from its
    // latest reading, as it did when raw rows were read newest first.
    groups = await prisma.$queryRaw`
      SELECT
        ${localDay} AS day_key,
        m."source"::text AS source,
        m."device_type" AS device_type,
        m."unit" AS unit,
        SUM(m."value")::float8 AS total,
        COUNT(*)::int AS n
      FROM measurements m
      WHERE ${filters}
        AND m."measured_at" >= ${spanStart}
        AND m."measured_at" < ${spanEnd}
      GROUP BY 1, 2, 3, 4
      ORDER BY 1, MAX(m."measured_at") DESC, 2, 3, 4
    `;
  }

  // v1.29.6 — collapse overlapping sources to the ladder-canonical
  // reading per day BEFORE summing. Without this, a day with both an
  // Apple Health AND a Withings write for the same cumulative metric
  // (e.g. steps) summed BOTH sources into one inflated total — a day
  // the dashboard tile (which reads through the source-collapsed
  // rollup, `collapseRollupRowsBySource` in
  // `src/lib/rollups/measurement-read.ts`) showed correctly. Uses the
  // same `metricKeyForType` ladder lookup the rollup collapse uses, so
  // this list and the tile agree on which source wins. A type with no
  // ladder (e.g. TIME_IN_DAYLIGHT, FALL_COUNT) has nothing to collapse
  // against — every group passes through unchanged. Each group stands at
  // its day's local noon, so the picker files it under the day SQL cut.
  const groupRows = groups.map((g) => ({
    ...g,
    type,
    deviceType: g.device_type,
    measuredAt: canonicalDailyTimestamp(g.day_key, tz),
  }));
  const metricKey = metricKeyForType(type);
  const priorityJson = metricKey ? await loadUserSourcePriority(user.id) : null;
  const canonicalGroups = metricKey
    ? pickCanonicalSourceRows(groupRows, metricKey, priorityJson, (d) =>
        dayKeyForUserTz(d, tz),
      ).canonicalRows
    : groupRows;

  // Sum per local day; unit and source come from the day's first kept group
  // so the rendered row carries a sensible label even when sources mix.
  const buckets = new Map<
    string,
    { total: number; sampleCount: number; unit: string; source: string }
  >();
  for (const g of canonicalGroups) {
    const slot = buckets.get(g.day_key);
    if (!slot) {
      buckets.set(g.day_key, {
        total: g.total,
        sampleCount: g.n,
        unit: g.unit,
        source: g.source,
      });
    } else {
      slot.total += g.total;
      slot.sampleCount += g.n;
    }
  }
  const rowsScanned = groups.reduce((sum, g) => sum + g.n, 0);
  const rowsKept = canonicalGroups.reduce((sum, g) => sum + g.n, 0);

  // Rows follow the page's day order from SQL.
  const measurements = dayKeys.flatMap((dayKey) => {
    const b = buckets.get(dayKey);
    if (!b) return [];
    return [
      {
        // Synthetic id so the list-row key stays stable across pages
        // and the row never collides with a real `Measurement.id`.
        id: `day:${type}:${dayKey}`,
        type,
        value: b.total,
        unit: b.unit,
        source: b.source,
        // Anchor the row's timestamp to local noon so the row sorts
        // cleanly between same-day spot samples — matches the
        // `canonicalDailyTimestamp` convention used by the drain.
        measuredAt: canonicalDailyTimestamp(dayKey, tz).toISOString(),
        notes: null,
        dayKey,
        sampleCount: b.sampleCount,
      },
    ];
  });

  annotate({
    action: { name: "measurement.list" },
    meta: {
      total,
      type,
      groupBy: "day",
      days: measurements.length,
      rowsScanned,
      droppedDuplicates: rowsScanned - rowsKept,
    },
  });
  return apiSuccess({
    measurements,
    meta: {
      total,
      limit,
      offset,
      groupBy: "day",
      droppedDuplicates: rowsScanned - rowsKept,
    },
  });
}

/**
 * A sleep page holds at most this many nights. The nights' stage rows are
 * read and reconstructed in the process, so the bound sits on the nights;
 * the applied value comes back as `meta.limit`, and `meta.total` still counts
 * every night, so a caller asking for more pages on rather than losing any.
 * Until v1.43.6 the list read no more than a year of nights however large
 * the limit, so this is a widening, never a new cut.
 */
const SLEEP_NIGHT_PAGE_MAX = 1000;

/**
 * v1.11.5 — per-night collapse for the SLEEP_DURATION list. Sleep is
 * stored one row per STAGE per night (minutes); a plain list leaks every
 * stage segment. This collapses the raw rows into the canonical per-night
 * shape used by the chart series + dashboard tile.
 *
 * Two modes:
 *  - `dayKey` set → drill-down: return the night's stage SEGMENTS (the
 *    canonical source's per-stage spans) so the list row can reveal the
 *    hypnogram's underlying rows, mirroring the cumulative-type drill-down.
 *  - no `dayKey` → one synthetic row per night, value = TIME ASLEEP in
 *    minutes (the canonical unit), with the per-night stage breakdown,
 *    nap count, and awakenings in the row so the UI can caption the night
 *    without a second fetch.
 *
 * The nights are paged in Postgres (`sleepNightPage`), like the days of the
 * cumulative list, and only the stage rows of the page's nights are read.
 * Until v1.43.6 the read stopped at a year before `to` and the list ended
 * there without saying so to the client.
 */
async function sleepListResponse(
  user: { id: string },
  opts: {
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
    sortDir: "asc" | "desc";
    dayKey?: string;
  },
) {
  const { from, to, offset, sortDir, dayKey } = opts;
  const limit = Math.min(opts.limit, SLEEP_NIGHT_PAGE_MAX);
  const [tz, priorityJson] = await Promise.all([
    resolveUserTimezone(user.id),
    loadUserSourcePriority(user.id),
  ]);

  const page = await sleepNightPage(user.id, tz, {
    from,
    to,
    sortDir,
    ...(dayKey ? { night: dayKey, limit: 1, offset: 0 } : { limit, offset }),
  });
  const nightKeys = page.nights.map((n) => n.night);
  const wanted = new Set(nightKeys);

  // The page's sessions lie between the first one's start and the last one's
  // end, and every other session is more than the session gap away from that
  // span, so this read holds the page's sessions whole and no part of any
  // other.
  let rows: Array<{
    id: string;
    value: number;
    measuredAt: Date;
    sleepStage: SleepStage | null;
    source: MeasurementSource;
    deviceType: string | null;
  }> = [];
  if (page.nights.length > 0) {
    let spanStart = page.nights[0].spanStart;
    let spanEnd = page.nights[0].spanEnd;
    for (const n of page.nights) {
      if (n.spanStart < spanStart) spanStart = n.spanStart;
      if (n.spanEnd > spanEnd) spanEnd = n.spanEnd;
    }
    rows = await prisma.measurement.findMany({
      where: {
        userId: user.id,
        type: "SLEEP_DURATION",
        deletedAt: null,
        AND: [
          { measuredAt: { gte: spanStart, lte: spanEnd } },
          ...(from ? [{ measuredAt: { gte: from } }] : []),
          ...(to ? [{ measuredAt: { lte: to } }] : []),
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
  const sessions = reconstructSleepSessions(rows, tz, priorityJson).filter(
    (s) => wanted.has(s.night),
  );

  // Drill-down — return the requested night's canonical stage segments.
  if (dayKey) {
    const { main, naps } = pickMainNightAndNaps(
      sessions.filter((s) => s.night === dayKey),
    );
    const dayUnit = getUnitForType("SLEEP_DURATION");
    // One row per stage segment of the main night + each nap, so the
    // drill-down reveals exactly the rows that summed into the headline.
    const segments = [main, ...naps]
      .filter((s): s is NonNullable<typeof s> => s != null)
      .flatMap((s) => s.segments);
    const measurements = segments
      .sort((a, b) =>
        sortDir === "asc"
          ? a.start.getTime() - b.start.getTime()
          : b.start.getTime() - a.start.getTime(),
      )
      .map((seg, i) => ({
        id: `sleep-seg:${dayKey}:${i}`,
        type: "SLEEP_DURATION",
        value: Math.round(seg.minutes),
        unit: dayUnit,
        source: main?.source ?? naps[0]?.source ?? "MANUAL",
        measuredAt: seg.end.toISOString(),
        sleepStage: seg.stage,
        notes: null,
      }));
    annotate({
      action: { name: "measurement.list" },
      meta: {
        total: measurements.length,
        type: "SLEEP_DURATION",
        dayKey,
        mode: "sleep-drill-down",
      },
    });
    return apiSuccess({
      measurements,
      meta: { total: measurements.length, limit, offset: 0, dayKey },
    });
  }

  // Per-night collapse — one synthetic row per wake day. The headline
  // value is the MAIN night's TIME ASLEEP (the longest session that day),
  // per the nap convention: naps are surfaced as a count, never folded
  // into the main night's headline.
  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = byDay.get(s.night) ?? [];
    list.push(s);
    byDay.set(s.night, list);
  }

  const dayUnit = getUnitForType("SLEEP_DURATION");
  // Rows follow the page's night order from SQL.
  const measurements = nightKeys.flatMap((day) => {
    const { main, naps } = pickMainNightAndNaps(byDay.get(day) ?? []);
    if (!main) return [];
    return [
      {
        // Synthetic id mirrors the series route's `sleep:<night>` shape.
        id: `sleep:${day}`,
        type: "SLEEP_DURATION",
        value: Math.round(main.asleepMinutes),
        unit: dayUnit,
        source: main.source ?? "MANUAL",
        measuredAt: main.end.toISOString(),
        notes: null,
        dayKey: day,
        // Drives the drill-down chevron — number of stage segments behind
        // the night, matching the cumulative-type `sampleCount` contract.
        sampleCount: main.segments.length,
        sleepStages: main.stages as Record<string, number>,
        inBedMinutes: main.inBedMinutes,
        awakeMinutes: main.awakeMinutes,
        napCount: naps.length,
        napAsleepMinutes: naps.reduce((sum, n) => sum + n.asleepMinutes, 0),
        awakenings: main.awakenings,
      },
    ];
  });

  annotate({
    action: { name: "measurement.list" },
    meta: {
      total: page.total,
      type: "SLEEP_DURATION",
      mode: "sleep-per-night",
      nights: measurements.length,
      rowsScanned: rows.length,
    },
  });
  return apiSuccess({
    measurements,
    meta: {
      total: page.total,
      limit,
      offset,
      groupBy: "night",
    },
  });
}

/**
 * One page of sleep nights, chosen in Postgres.
 *
 * The stage rows are cut into sessions the way `reconstructSleepSessions`
 * cuts them: ordered by start (`measured_at` minus the minutes), a new
 * session wherever a row starts more than `SESSION_GAP_MS` after every
 * earlier row has ended. A session counts when it holds an asleep row (a
 * bare or granular asleep stage, or a stage-less one, with minutes), and its
 * night is the local day its last row ends on. Nights are grouped, sorted
 * and cut by `limit` / `offset`; `total` is the night count of the whole
 * filtered set from the same query. `spanStart` / `spanEnd` bound the
 * night's counting sessions, so the caller reads exactly their rows.
 *
 * The session's night here is taken over every writer, while the JS fold
 * takes it over the winning writer only. They part only when a losing writer
 * runs past midnight and the winner does not; that night then sits on the
 * page and comes back without a row, and `total` counts it.
 */
async function sleepNightPage(
  userId: string,
  tz: string,
  opts: {
    from?: Date;
    to?: Date;
    sortDir: "asc" | "desc";
    limit: number;
    offset: number;
    night?: string;
  },
): Promise<{
  nights: Array<{ night: string; spanStart: Date; spanEnd: Date }>;
  total: number;
}> {
  const zone = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const gapSeconds = SESSION_GAP_MS / 1000;
  // Direction comes from the Zod enum, never from raw input.
  const direction = Prisma.raw(opts.sortDir === "asc" ? "ASC" : "DESC");
  const nightsCte = Prisma.sql`
    WITH r AS (
      SELECT
        m."measured_at" AS e,
        m."measured_at" - m."value" * interval '1 minute' AS s,
        (m."value" > 0 AND (m."sleep_stage" IS NULL
          OR m."sleep_stage" IN ('ASLEEP', 'REM', 'CORE', 'DEEP'))) AS asleep
      FROM measurements m
      WHERE m."user_id" = ${userId}
        AND m."type" = 'SLEEP_DURATION'::measurement_type
        AND m."deleted_at" IS NULL
        ${opts.from ? Prisma.sql`AND m."measured_at" >= ${opts.from}` : Prisma.empty}
        ${opts.to ? Prisma.sql`AND m."measured_at" <= ${opts.to}` : Prisma.empty}
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
        to_char((e AT TIME ZONE 'UTC') AT TIME ZONE ${zone}, 'YYYY-MM-DD') AS night,
        MIN(s) AS span_start,
        MAX(e) AS span_end
      FROM sess
      GROUP BY 1
    )
  `;
  const rows = await prisma.$queryRaw<
    Array<{ night: string; span_start: Date; span_end: Date; total: number }>
  >`
    ${nightsCte}
    SELECT night, span_start, span_end, (COUNT(*) OVER ())::int AS total
    FROM nights
    ${opts.night ? Prisma.sql`WHERE night = ${opts.night}` : Prisma.empty}
    ORDER BY night ${direction}
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `;
  // A page past the end has no row to carry the total; only then is it
  // counted on its own.
  const total =
    rows.length > 0
      ? Number(rows[0].total)
      : opts.offset > 0
        ? Number(
            (
              await prisma.$queryRaw<Array<{ total: number }>>`
                ${nightsCte}
                SELECT COUNT(*)::int AS total FROM nights
              `
            )[0]?.total ?? 0,
          )
        : 0;
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
 * Does this body attribute a source to any reading — any source at all?
 *
 * Read off the RAW body rather than the parsed result, and that is load-bearing
 * twice over. It has to give the same answer for the object arm and the array
 * arm, which parse against different schemas further down; and
 * `createMeasurementSchema.source` carries `.default("MANUAL")`, so after
 * parsing "said MANUAL" and "said nothing" are the same value and the
 * distinction this predicate exists to draw is already gone.
 *
 * v1.38.x — widened from "names APPLE_HEALTH" to "names anything". Under a
 * scoped credential the row's source is now resolved by the server, so an
 * explicit `MANUAL` is an assertion the route would have to override — which
 * is the silent relabelling the refusal below refuses to do.
 *
 * Anything that is not a recognisable measurement shape answers false and
 * falls through to the validation error it has coming: this function decides
 * attribution, not validity.
 */
function namesAnySource(body: unknown): boolean {
  const names = (entry: unknown): boolean =>
    typeof entry === "object" &&
    entry !== null &&
    (entry as { source?: unknown }).source !== undefined;
  return Array.isArray(body) ? body.some(names) : names(body);
}

export const POST = apiHandler(withIdempotency<[NextRequest]>(postMeasurement));

async function postMeasurement(request: NextRequest) {
  // v1.36.x — a delegated write. `user` is the record the reading belongs to,
  // which every `userId: user.id` below already meant; the caller is somebody
  // who may or may not be that person. Nothing else in this handler reads the
  // caller: the safety-floor check, the reminder satisfaction, the rollup
  // recompute and the cache eviction are all statements about the record.
  //
  // v1.38.x — it also declares the third-party ingest scope, so a narrow
  // `measurements:write` token reaches this arm. The two declarations do not
  // interact: a scoped credential is refused the moment the request names
  // another record, before any grant is read, so "delegable" and "reachable by
  // a bridge token" stay separate properties of the same route.
  const auth = await requireRecordAuth("write", "measurements", {
    scope: MEASUREMENTS_WRITE_SCOPE,
  });
  const { user } = auth;
  const scoped = isScopedCredential(auth);

  // Shared per-account write ceiling — see `checkRecordWriteRateLimit`. The
  // batch siblings have always been capped; the per-record creates a looping
  // client hits were not.
  const writeRl = await checkRecordWriteRateLimit(auth.actor.id);
  if (!writeRl.allowed) {
    return apiError("Too many writes, try again later", 429, {
      errorCode: "record_write.rate_limited",
    });
  }

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 64 * 1024,
  });

  if (jsonError) return jsonError;

  // A scoped credential may attribute nothing: the source of its rows is
  // `EXTERNAL`, decided here from the credential rather than taken from the
  // body. Checked before the validation branches so the object and array arms
  // share one answer, and refused rather than rewritten for the reason the
  // batch route gives: relabelling a client's explicit assertion hands it rows
  // it did not ask for and no way to notice.
  //
  // v1.38.x — this used to refuse only an explicit `APPLE_HEALTH`, because the
  // forced value was `MANUAL` and so a body naming `MANUAL` was never actually
  // overridden. Now that bridge rows carry their own provenance, honouring
  // such a body would defeat the point (a bridge that kept sending `MANUAL`
  // would stay indistinguishable from a typed reading) and overriding it
  // silently is what the paragraph above forbids. Status and `errorCode` are
  // unchanged, so client error handling is untouched; the documented Home
  // Assistant payload sends no `source` at all.
  if (scoped && namesAnySource(body)) {
    annotate({ action: { name: "measurements.create.source-not-permitted" } });
    return apiError(
      "This credential resolves the source itself; omit the field",
      422,
      { errorCode: "measurement.create.source_not_permitted" },
    );
  }

  // One sleep-stage segment, the stage named rather than coded. A bridge
  // (Tasker, Home Assistant) posts here with its narrow token; the row and
  // its dedupe are the batch route's. See `sleep-stage-entry.ts`.
  if (isNamedSleepStageBody(body)) {
    return postNamedSleepStage(request, user.id, body, scoped);
  }

  // Batch mode (array of measurements, e.g. combined BP + Pulse)
  if (Array.isArray(body)) {
    const parsed = createBatchMeasurementSchema.safeParse({
      measurements: body,
    });
    if (!parsed.success) {
      // v1.4.43 W6 — iOS batch ingest (BP + Pulse, combined BG) needs
      // every issue echoed back so a one-shot retry can fix the full
      // payload rather than walk it field-by-field.
      const issues = sanitiseZodIssues(parsed.error.issues);
      annotate({
        action: { name: "measurements.create.batch.validation-failed" },
        meta: { issue_count: issues.length },
      });
      // v1.4.49 — strip `message` from the audit-ledger row; batch
      // rows carry free-text `notes` per measurement.
      const auditIssues = sanitiseZodIssues(parsed.error.issues, {
        stripValuesFromMessage: true,
      });
      // v1.36.x — through `auditLog()` rather than a bare `prisma.auditLog
      // .create`, because that helper is the only thing that stamps
      // `actorUserId`. Filed under the resolved record either way; without the
      // stamp a delegate's malformed batch would read as the owner's own.
      void auditLog("measurements.create.batch.validation-failed", {
        userId: user.id,
        details: { issues: auditIssues },
      }).catch(() => {
        /* swallow — 422 response is the contract */
      });
      return returnAllZodIssues(parsed.error, 422, {
        errorCode: "measurement.create.invalid",
      });
    }

    // The whole batch is one transaction, so a duplicate anywhere in it rolls
    // the rest back — and the caller has to be told which condition it hit.
    // Untouched, that duplicate escaped as an unhandled error and the batch
    // answered 500, which is indistinguishable from a server fault and is what
    // every client retries against.
    let results;
    try {
      results = await prisma.$transaction(
        parsed.data.measurements.map((m) =>
          prisma.measurement.create({
            data: {
              userId: user.id,
              type: m.type as MeasurementType,
              value: m.value,
              unit: getUnitForType(m.type),
              // v1.38.x — the array arm too, not just the single create
              // below. This is the combined BP + Pulse path a bridge uses for
              // a two-value reading; missing it here would leave exactly those
              // rows attributed MANUAL and invisible to the badge and the
              // source filter. `scoped` already implies `m.source` is
              // undefined — the refusal above returned otherwise — so this is
              // the resolution, not an override.
              source: (scoped
                ? EXTERNAL_SOURCE
                : (m.source ?? "MANUAL")) as MeasurementSource,
              measuredAt: m.measuredAt,
              // v1.23 — encrypt the note at rest; the legacy plaintext column is
              // written null for new rows.
              notes: null,
              notesEncrypted: encryptNote(m.notes ?? null),
              glucoseContext:
                (m.glucoseContext as GlucoseContext | undefined) ?? null,
              // v1.4.25 W10 reconcile (code-review M4): mirror the
              // single-entry path so the multi-entry batch persists
              // `deviceType` instead of silently dropping it.
              deviceType: m.deviceType ?? null,
            },
          }),
        ),
      );
    } catch (err) {
      if (isP2002(err)) {
        return apiError("A measurement with this data already exists", 409, {
          errorCode: "measurement.duplicate_timestamp",
        });
      }
      throw err;
    }

    const shapedResults = results.map(shapeMeasurementNotes);

    await auditLog("measurement.create.batch", {
      userId: user.id,
      ipAddress: getClientIp(request),
      details: {
        count: results.length,
        types: parsed.data.measurements.map((m) => m.type),
      },
    });

    annotate({
      action: { name: "measurement.create.batch" },
      meta: {
        count: results.length,
        types: parsed.data.measurements.map((m) => m.type),
      },
    });

    // v1.4.34 IW-G — flush every cache that reflects this user's
    // measurement set so the next read paints the new rows. Interactive
    // multi-entry create (combined BP + pulse form) — hard-evict so the
    // SWR readers don't serve the pre-write body back to the user.
    invalidateUserMeasurements(user.id, { evict: true });

    // v1.18.1 — eventful Vorsorge satisfaction. Resolve the user's
    // reminders against the just-landed readings now. Fire-and-forget.
    fireAndForget(enqueueReminderSatisfy(user.id), {
      action: "reminder.satisfy.enqueue",
    });

    // v1.31.0 — feed the shared arrival seams only the rows returned by the
    // create-only transaction. Both callbacks are best-effort: arrival or
    // morning-refresh infrastructure can never turn a committed write into an
    // error response.
    void emitInsertedMeasurementArrivals(user.id, results, "manual").catch(
      () => {},
    );
    const sleepMeasuredAts = results
      .filter((row) => row.type === "SLEEP_DURATION")
      .map((row) => row.measuredAt);
    if (sleepMeasuredAts.length > 0) {
      void maybeEnqueueMorningRefresh(user.id, sleepMeasuredAts).catch(
        () => {},
      );
    }

    // v1.18.6 — absolute clinical safety-floor check on the just-written
    // readings (confirm-gated, module-gated, never diagnoses). The combined
    // BP form lands both arms here, so the BP floor sees a whole reading.
    // The transient per-entry `symptomsPresent` flag (ORed across the batch)
    // lifts a confirmed breach to the symptom-coupled emergency copy.
    // Fire-and-forget — a notification failure never fails the write.
    fireAndForget(
      runSafetyFloorCheck({
        userId: user.id,
        written: results.map((r) => ({
          type: r.type,
          value: r.value,
          measuredAt: r.measuredAt,
          glucoseContext: r.glucoseContext,
        })),
        symptomsPresent: parsed.data.measurements.some(
          (m) => m.symptomsPresent === true,
        ),
        timezone: user.timezone ?? undefined,
      }),
      { action: "measurement.safety_floor.check" },
    );

    // v1.37.19 (C2-F1) — the shared post-mutation tail: rollup recompute
    // (collapsed per (type, day)) + status-insight re-warm, both
    // best-effort. One helper so a future write surface cannot remember
    // one leg and forget the other.
    await afterMeasurementMutation(
      user.id,
      results.map((r) => ({ type: r.type, measuredAt: r.measuredAt })),
      { source: "manual" },
    );

    return apiSuccess(shapedResults, 201);
  }

  // Single mode (existing behavior)
  const parsed = createMeasurementSchema.safeParse(body);
  if (!parsed.success) {
    // v1.4.43 W6 — single-row POST is the iOS fallback path; one
    // round-trip per stale-field bug was the v1.4.41 iOS-contract
    // pain point. Multi-issue envelope + audit breadcrumb.
    const issues = sanitiseZodIssues(parsed.error.issues);
    annotate({
      action: { name: "measurements.create.validation-failed" },
      meta: { issue_count: issues.length },
    });
    // v1.4.49 — strip `message` from the audit-ledger row; single
    // measurement carries free-text `notes`.
    const auditIssues = sanitiseZodIssues(parsed.error.issues, {
      stripValuesFromMessage: true,
    });
    // v1.36.x — see the batch arm above: only `auditLog()` stamps the actor.
    void auditLog("measurements.create.validation-failed", {
      userId: user.id,
      details: { issues: auditIssues },
    }).catch(() => {
      /* swallow — 422 response is the contract */
    });
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "measurement.create.invalid",
    });
  }

  const {
    type,
    value,
    measuredAt,
    notes,
    source,
    glucoseContext,
    deviceType,
    symptomsPresent,
  } = parsed.data;

  // Handle unique constraint violation
  let measurement;
  try {
    measurement = await prisma.measurement.create({
      data: {
        userId: user.id,
        type: type as MeasurementType,
        value,
        unit: getUnitForType(type),
        // v1.38.x — server-resolved under a scoped credential. `source` is
        // necessarily the schema default here (the refusal above returned on
        // any body that named one), so nothing a caller asserted is being
        // discarded.
        source: (scoped
          ? EXTERNAL_SOURCE
          : (source ?? "MANUAL")) as MeasurementSource,
        measuredAt,
        // v1.23 — encrypt the note at rest; legacy plaintext column nulled.
        notes: null,
        notesEncrypted: encryptNote(notes ?? null),
        glucoseContext: (glucoseContext as GlucoseContext | undefined) ?? null,
        // v1.4.25 W10 reconcile (code-review M4): the deviceType column
        // already accepts client metadata from the batch route. Mirror
        // the behaviour here so single-entry POST persists the tag
        // instead of silently dropping it.
        deviceType: deviceType ?? null,
      },
    });
  } catch (err) {
    // `isP2002` rather than `instanceof Prisma.PrismaClientKnownRequestError`.
    // The helper's own docblock says why it exists: the structural check
    // survives client-bundling quirks, and the `instanceof` form does not —
    // when it misses, a duplicate escapes as an unhandled error and the caller
    // gets a 500 for a condition the route has always meant to answer with a
    // 409. A retry loop that meets a 500 keeps retrying.
    if (isP2002(err)) {
      return apiError("A measurement with this data already exists", 409, {
        errorCode: "measurement.duplicate_timestamp",
      });
    }
    throw err;
  }

  await auditLog("measurement.create", {
    userId: user.id,
    ipAddress: getClientIp(request),
    details: { type, measurementId: measurement.id },
  });

  annotate({
    action: {
      name: "measurement.create",
      entity_type: "measurement",
      entity_id: measurement.id,
    },
  });

  // v1.4.34 IW-G — flush every cache that reflects this user's
  // measurement set so the next read paints the new row. Interactive
  // single-entry create — hard-evict so the SWR readers don't serve the
  // pre-write body back to the user.
  invalidateUserMeasurements(user.id, { evict: true });

  // v1.18.1 — eventful Vorsorge satisfaction. Resolve the user's reminders
  // against the just-landed reading now. Fire-and-forget.
  fireAndForget(enqueueReminderSatisfy(user.id), {
    action: "reminder.satisfy.enqueue",
  });

  // v1.31.0 — `measurement` is the exact successful create result. A P2002
  // duplicate returns above and never reaches either best-effort callback.
  void emitInsertedMeasurementArrivals(user.id, [measurement], "manual").catch(
    () => {},
  );
  if (measurement.type === "SLEEP_DURATION") {
    void maybeEnqueueMorningRefresh(user.id, [measurement.measuredAt]).catch(
      () => {},
    );
  }

  // v1.18.6 — absolute clinical safety-floor check (confirm-gated,
  // module-gated, never diagnoses). A single-entry POST carries only one arm
  // of a BP reading, so the BP floor only fires through the combined-form /
  // batch path; a lone glucose reading is evaluated here. The transient
  // `symptomsPresent` flag lifts a confirmed breach to the emergency copy.
  // Fire-and-forget — a notification failure never fails the write.
  fireAndForget(
    runSafetyFloorCheck({
      userId: user.id,
      written: [
        {
          type: measurement.type,
          value: measurement.value,
          measuredAt: measurement.measuredAt,
          glucoseContext: measurement.glucoseContext,
        },
      ],
      symptomsPresent,
      timezone: user.timezone ?? undefined,
    }),
    { action: "measurement.safety_floor.check" },
  );

  // v1.5.0 — refresh the persistent rollup row for the affected
  // (type, day) tuple. Runs inline so the next read of the
  // comprehensive / analytics surface is correct without waiting on
  // pg-boss; WEEK / MONTH / YEAR recomputes are enqueued under the
  // hood. Best-effort — a populator hiccup never fails the user's
  // write.
  await afterMeasurementMutation(
    user.id,
    [{ type: measurement.type, measuredAt: measurement.measuredAt }],
    { source: "manual" },
  );

  return apiSuccess(shapeMeasurementNotes(measurement), 201);
}

/**
 * `POST /api/measurements` with a named `sleepStage`: one segment, stored as
 * the batch route stores a HealthKit sleep sample.
 *
 * The same three steps as the batch route, in the same order: a same-reading
 * row of the opposite source (MANUAL against APPLE_HEALTH) makes this one a
 * duplicate; otherwise `reconcileExternalMeasurement` settles both unique
 * identities at once, reporting an exact external-id match as a duplicate
 * and adopting a row that only shares the natural identity. So a bridge that
 * re-posts the same segment gets one row, whichever path it used first.
 *
 * `201` with the stored row when it was inserted, `200` when it was already
 * there (`duplicate`) or was corrected in place (`updated`). The row carries
 * a `status` saying which.
 */
async function postNamedSleepStage(
  request: NextRequest,
  userId: string,
  body: unknown,
  scoped: boolean,
): Promise<Response> {
  const parsed = sleepStageEntrySchema.safeParse(body);
  if (!parsed.success) {
    annotate({
      action: { name: "measurements.create.sleep-stage.validation-failed" },
      meta: { issue_count: sanitiseZodIssues(parsed.error.issues).length },
    });
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "measurement.create.invalid",
    });
  }

  const segment = toSleepStageSegment(parsed.data);
  // Under a scoped credential the source is resolved from the credential,
  // as on the other arms of this route: the refusal above already returned
  // on any body that named one.
  const source = (
    scoped ? EXTERNAL_SOURCE : parsed.data.source
  ) as MeasurementSource;
  const type: MeasurementType = "SLEEP_DURATION";

  // Cross-source same reading, exactly as the batch route decides it.
  if (isMergeableSource(source)) {
    const candidates = await prisma.measurement.findMany({
      where: {
        userId,
        deletedAt: null,
        type,
        source: oppositeMergeSource(source),
        measuredAt: {
          gte: new Date(segment.end.getTime() - MEASURED_AT_TOLERANCE_MS),
          lte: new Date(segment.end.getTime() + MEASURED_AT_TOLERANCE_MS),
        },
      },
      select: {
        id: true,
        type: true,
        source: true,
        value: true,
        measuredAt: true,
      },
    });
    const twin = candidates.find((candidate) =>
      isSameReadingAcrossSource(
        { type, source, value: segment.minutes, measuredAt: segment.end },
        candidate,
      ),
    );
    if (twin) {
      return namedSleepStageResponse(twin.id, "duplicate", {
        stage: segment.stage,
        source,
        crossSource: true,
      });
    }
  }

  const verdict = await prisma.$transaction((tx) =>
    reconcileExternalMeasurement(
      tx,
      {
        userId,
        type,
        value: segment.minutes,
        unit: getUnitForType(type),
        source,
        measuredAt: segment.end,
        externalId: segment.externalId,
        externalSourceVersion: null,
        sleepStage: segment.stage,
        deviceType: parsed.data.deviceType ?? null,
      },
      { exactExternalMatch: "duplicate" },
    ),
  );

  if (verdict.status === "failed") {
    throw new MeasurementReconciliationError(verdict);
  }
  if (verdict.status === "rejected_range") {
    // The schema applies the same band, so this is the two gates disagreeing.
    return apiError("Value out of plausible range", 422, {
      errorCode: "measurement.create.invalid",
    });
  }

  const status =
    verdict.status === "inserted"
      ? "inserted"
      : verdict.status === "duplicate"
        ? "duplicate"
        : "updated";

  if (status !== "duplicate") {
    await auditLog("measurement.create", {
      userId,
      ipAddress: getClientIp(request),
      details: {
        type,
        measurementId: verdict.row.id,
        sleepStage: segment.stage,
        status,
      },
    });
    invalidateUserMeasurements(userId, { evict: true });
    fireAndForget(enqueueReminderSatisfy(userId), {
      action: "reminder.satisfy.enqueue",
    });
    if (status === "inserted") {
      void emitInsertedMeasurementArrivals(
        userId,
        [verdict.row],
        "manual",
      ).catch(() => {});
      void maybeEnqueueMorningRefresh(userId, [segment.end]).catch(() => {});
    }
    await afterMeasurementMutation(
      userId,
      [{ type, measuredAt: segment.end }, ...(verdict.dirtyIdentities ?? [])],
      { source: "manual" },
    );
  }

  return namedSleepStageResponse(verdict.row.id, status, {
    stage: segment.stage,
    source,
    crossSource: false,
  });
}

async function namedSleepStageResponse(
  id: string,
  status: "inserted" | "updated" | "duplicate",
  meta: { stage: string; source: string; crossSource: boolean },
): Promise<Response> {
  annotate({
    action: {
      name: "measurement.create.sleep-stage",
      entity_type: "measurement",
      entity_id: id,
    },
    meta: {
      status,
      stage: meta.stage,
      source: meta.source,
      cross_source_merge: meta.crossSource,
    },
  });
  const row = await prisma.measurement.findUniqueOrThrow({ where: { id } });
  return apiSuccess(
    { ...shapeMeasurementNotes(row), status },
    status === "inserted" ? 201 : 200,
  );
}
