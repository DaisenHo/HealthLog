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
import { dayGroupedListResponse } from "@/lib/measurements/list/day-grouped";
import { sleepListResponse } from "@/lib/measurements/list/sleep-list";
import { resolveStoredTimezone, resolveUserTimezone } from "@/lib/tz/resolver";
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
import type {
  MeasurementType,
  MeasurementSource,
  GlucoseContext,
} from "@/generated/prisma/client";

export const GET = apiHandler(async (request: NextRequest) => {
  const { user } = await requireRecordAuth("read", "measurements");

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = listMeasurementsSchema.safeParse(params);
  if (!parsed.success) {
    // v1.4.43 — surface every Zod issue under `details.issues` so a
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
    // v1.4.40 — soft-deleted readings are invisible to every
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

  // v1.4.37 — list-view drill-down to per-sample rows for a single
  // calendar day in the user's IANA timezone. Resolves the day's UTC
  // bounds against `User.timezone`, then runs a plain `findMany` so the
  // expandable list row shows every per-sample chunk the daily collapse
  // hid. Gated to cumulative HK types — the spot-sample types render
  // one-row-per-event already and have nothing to drill into.
  if (dayKey && type && CUMULATIVE_HK_TYPES.has(type as MeasurementType)) {
    // The same zone the day-grouped list cuts its days in, so a row's
    // drill-down opens exactly the day the row summed.
    const tz = await resolveStoredTimezone(user.timezone);
    // Resolve `[dayStart, dayEnd)` for the requested calendar day in
    // the user's local zone. v1.4.37 — `localDayWindow` honours
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

  // v1.4.37 — collapsed "one row per day" mode for cumulative
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
      from,
      to,
    });
  }

  // v1.4.28 — server-side aggregation. Gated on an explicit
  // `aggregate` param so the iOS contract (raw `MeasurementWireDTO`
  // shape on `GET /api/measurements`) is byte-stable for any caller
  // that omits the new query parameter. The chart-data client opts
  // in; iOS does not.
  //
  // `take` no longer applies BEFORE bucketising. The
  // aggregation runs in Postgres via `date_trunc`, the bucket cap is
  // applied AFTER, so a 1-year `aggregate=daily` window walks every
  // row in the window and returns up to 365 buckets per type instead
  // of truncating to the first N raw rows.
  //
  // "All time" range semantics. When the chart's "All" tab
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
      // v1.4.43 — iOS batch ingest (BP + Pulse, combined BG) needs
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
              // v1.4.25 (code-review M4): mirror the
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

    // v1.4.34 — flush every cache that reflects this user's
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

    // v1.37.19 — the shared post-mutation tail: rollup recompute
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
    // v1.4.43 — single-row POST is the iOS fallback path; one
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
        // v1.4.25 (code-review M4): the deviceType column
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

  // v1.4.34 — flush every cache that reflects this user's
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
