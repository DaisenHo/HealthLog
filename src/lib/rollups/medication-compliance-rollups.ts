/**
 * v1.4.39 W-MED — persistent medication-compliance rollup tier.
 *
 * Replaces the unbounded `MedicationIntakeEvent.findMany` walk on
 * `/api/medications/intake?scope=compliance` with a ledger keyed
 * `(userId, medicationId, day)` where `day` is `YYYY-MM-DD` anchored
 * to the user's IANA timezone.
 *
 * Write hooks fire from every `MedicationIntakeEvent` mutation site
 * (create / update / delete / bulk import) plus the reminder-worker's
 * mint path that creates `takenAt:null` rows on RED-phase reminders.
 * The dashboard tile it was built for reads the schedule-anchored
 * compliance (`src/lib/analytics/schedule-anchored-compliance.ts`) since
 * v1.26, and the per-day recompute below is now what keeps a day's
 * supplement nutrients in step with its doses; the table itself has no
 * reader left.
 *
 * v1.15.18 DESIGN DECISION — this tier stays a RAW per-day COVERAGE count,
 * NOT the band-attributed compliance %. It aggregates, across ALL of a
 * user's medications, "of the intake rows whose `scheduled_for` lands on
 * this day, how many carry a non-null `taken_at`" — a coarse daily
 * cross-medication coverage strip for the dashboard mini-tiles. The
 * unified band-membership attribution (the `tallyComplianceFromLedger`
 * keystone) is per-medication and per-cadence: it depends on the slot
 * bands of each schedule and the user timezone, which cannot be expressed
 * in a single cross-medication SQL `SUM(CASE …)`. Re-attributing every
 * intake against its cadence's bands before the tally would mean running
 * the band minter per `(medication, day)` inside the rollup, which defeats
 * the rollup's whole purpose (bounded SQL, no per-row Node walk). The
 * detail page + the medication card already read the band-attributed % via
 * `calculateCompliance` / `complianceChips`; this tier deliberately remains
 * the cheaper coverage signal and is documented as such so the two are not
 * confused. The `scheduled` / `taken` column names reflect this: a day's
 * `taken` is "slots with an intake logged taken", not "doses inside their
 * on-time band".
 *
 * v1.15.19 — the count is SLOT-level, not row-level. The partial unique
 * index on `(user, medication, scheduled_for, source)` lets two live rows
 * share one slot instant when their `source` differs (e.g. a pending
 * REMINDER row plus a taken API row for the same dose); a row-level
 * `COUNT(*)` double-counted that slot as two scheduled doses. The
 * aggregate now groups by `scheduled_for` first: `scheduled` counts
 * distinct slot instants, and each slot folds its rows with
 * taken-beats-skipped priority (`BOOL_OR` of taken, then skipped only when
 * no row in the slot is taken). This neutralises cross-source duplicate
 * rows retroactively — any recompute over pre-existing duplicates yields
 * the deduplicated counts without a data migration.
 *
 * Audit anchor: `.planning/round-v1438-perf-analysis.md` §2.5 + §5 P4.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getGlobalBoss } from "@/lib/jobs/boss-instance";
import { refreshSupplementNutrientsForDose } from "@/lib/medications/ingredients/recompute";
import { annotate } from "@/lib/logging/context";
import { DEFAULT_TIMEZONE, isValidTimezone, userDayKey } from "@/lib/tz/format";
import { localDayWindow, startOfLocalDayKey } from "@/lib/tz/local-day";

/**
 * pg-boss queue name for the boot-time medication compliance backfill.
 * Mirrors the `rollup-full-backfill` v1.4.35.1 pattern: discovery is
 * idempotent across reboots and the worker upserts every
 * `(user, medication, day)` row for the trailing window.
 */
export const MEDICATION_COMPLIANCE_BACKFILL_QUEUE =
  "medication-compliance-full-backfill";

/** Worker concurrency cap — backfill stays serial to spare the pool. */
export const MEDICATION_COMPLIANCE_BACKFILL_CONCURRENCY = 1;

/** Trailing window the boot backfill folds per uncovered user. */
export const MEDICATION_COMPLIANCE_BACKFILL_DAYS = 90;

/** Payload `boss.send` carries onto the backfill queue. */
export interface MedicationComplianceBackfillPayload {
  userId: string;
  /** Wall-clock kick-off for debugging only. */
  enqueuedAt: string;
}

/**
 * Resolve a safe tz string — fall back to the server default when the
 * supplied value is missing or not an IANA zone the host recognises.
 */
function safeTimezone(tz: string | null | undefined): string {
  if (tz && isValidTimezone(tz)) return tz;
  return DEFAULT_TIMEZONE;
}

/**
 * Convert a `scheduledFor` UTC instant to the user's `YYYY-MM-DD`
 * day-key. Re-exposed so the write-hook caller can derive the same
 * `dayKey` the rollup row is anchored on.
 */
export function dayKeyForScheduledFor(
  scheduledFor: Date,
  tz: string | null | undefined,
): string {
  return userDayKey(scheduledFor, safeTimezone(tz));
}

type MedicationComplianceRollupClient = Pick<PrismaClient, "$executeRaw">;

/**
 * Recompute the rollup row for one `(userId, medicationId, dayKey)`
 * tuple. Reads every `MedicationIntakeEvent` whose `scheduledFor` lands
 * in `[startOfDayInTz, startOfNextDayInTz)` then upserts the
 * `medication_compliance_rollups` row.
 *
 * The hook is idempotent: re-running for the same key produces the
 * same row. When the day window holds zero events the row is deleted
 * so the read path returns the trailing-window zero-default rather
 * than a stale stub.
 *
 */
export async function recomputeMedicationComplianceForDay(
  userId: string,
  medicationId: string,
  dayKey: string,
  tz: string | null | undefined,
  client: MedicationComplianceRollupClient = prisma,
): Promise<void> {
  const safeTz = safeTimezone(tz);
  // The local day's own bounds: 23, 24 or 25 hours on DST days.
  const { dayStart: start, dayEnd: windowEnd } = localDayWindow(dayKey, safeTz);

  // v1.4.39 hotfix (QA F-H-02): atomic upsert closes the race window
  // between the prior `SELECT … aggregate then UPSERT` pattern. Two
  // concurrent writes for the same (user, medication, day) used to
  // interleave A-SELECT → B-SELECT → B-UPSERT (correct) → A-UPSERT
  // (stale N-1). The INSERT … SELECT re-aggregates inside the upsert
  // statement so each write commits with a snapshot taken after the
  // prior commit released its row lock; the trailing DELETE handles
  // the "all events for the day were removed" case in the same shot.
  //
  // Both statements key on (user_id, medication_id, day) so they
  // serialise behind the row lock the rollup table's primary key
  // provides. The DELETE runs second so it cannot clobber a row the
  // INSERT just wrote — when the day still has events the
  // `WHERE NOT EXISTS` predicate matches zero rows.
  // v1.15.19 — slot-level aggregation. The inner CTE folds the rows that
  // share one `scheduled_for` instant (cross-source duplicates: pending
  // REMINDER + taken API) into one slot with taken-beats-skipped priority;
  // the outer aggregate then counts slots, not rows, so a duplicated slot
  // can never inflate `scheduled`. Pure SQL — re-running the recompute
  // over historic duplicates self-corrects the counts.
  await client.$executeRaw`
    WITH slot AS (
      SELECT
        BOOL_OR("taken_at" IS NOT NULL AND NOT "skipped") AS slot_taken,
        BOOL_OR("skipped")                                AS slot_skipped
      FROM "medication_intake_events"
      WHERE "user_id"        = ${userId}
        AND "medication_id"  = ${medicationId}
        AND "deleted_at"     IS NULL
        AND "scheduled_for" >= ${start}
        AND "scheduled_for" <  ${windowEnd}
      GROUP BY "scheduled_for"
    ),
    aggregate AS (
      SELECT
        COUNT(*)::int                                                            AS scheduled,
        COALESCE(SUM(CASE WHEN "slot_taken" THEN 1 ELSE 0 END), 0)::int          AS taken,
        COALESCE(SUM(CASE WHEN NOT "slot_taken" AND "slot_skipped" THEN 1 ELSE 0 END), 0)::int AS skipped
      FROM slot
    )
    INSERT INTO "medication_compliance_rollups"
      ("user_id", "medication_id", "day", "scheduled", "taken", "skipped", "computed_at")
    SELECT
      ${userId},
      ${medicationId},
      ${dayKey},
      aggregate.scheduled,
      aggregate.taken,
      aggregate.skipped,
      NOW()
    FROM aggregate
    WHERE aggregate.scheduled > 0
    ON CONFLICT ("user_id", "medication_id", "day") DO UPDATE
      SET "scheduled"   = EXCLUDED."scheduled",
          "taken"       = EXCLUDED."taken",
          "skipped"     = EXCLUDED."skipped",
          "computed_at" = EXCLUDED."computed_at"
  `;
  await client.$executeRaw`
    DELETE FROM "medication_compliance_rollups"
    WHERE "user_id"       = ${userId}
      AND "medication_id" = ${medicationId}
      AND "day"           = ${dayKey}
      AND NOT EXISTS (
        SELECT 1
        FROM "medication_intake_events"
        WHERE "user_id"        = ${userId}
          AND "medication_id"  = ${medicationId}
          AND "deleted_at"     IS NULL
          AND "scheduled_for" >= ${start}
          AND "scheduled_for" <  ${windowEnd}
      )
  `;

  // v1.43 — the day's other derived row: the micronutrients its taken
  // supplement doses add (`source = SUPPLEMENT`). Every dose write path
  // already funnels through this recompute, so this is the one place the
  // hook needs to live. Only on the base client: a caller inside its own
  // transaction (the dose import) has not committed the doses yet and
  // queues the account's full recompute once it has.
  if (client === prisma) {
    await refreshSupplementNutrientsForDose({
      userId,
      medicationId,
      dayKey,
      timezone: safeTz,
    });
  }
}

/**
 * Convenience hook for write-paths that have the `scheduledFor`
 * instant in hand. Derives `dayKey` in the user's tz then dispatches
 * to `recomputeMedicationComplianceForDay`. Best-effort: surfaces
 * failures through `annotate` + `console.error` so a silent populator
 * regression shows up in ops without blocking the parent write.
 */
export async function recomputeMedicationComplianceForEvent(input: {
  userId: string;
  medicationId: string;
  scheduledFor: Date;
  tz: string | null | undefined;
}): Promise<void> {
  const dayKey = dayKeyForScheduledFor(input.scheduledFor, input.tz);
  try {
    await recomputeMedicationComplianceForDay(
      input.userId,
      input.medicationId,
      dayKey,
      input.tz,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    annotate({
      meta: {
        medication_compliance_rollup_failed: true,
        medication_compliance_rollup_error: message,
      },
    });
    console.error("[medication-compliance-rollups] recompute failed:", message);
  }
}

/**
 * Full-fold helper. Walks every `(medicationId, day)` pair the user
 * has logged across the trailing `days` window and upserts each
 * rollup row. The boot-time backfill worker calls this once per
 * uncovered user; the route's lazy fallback enqueues it when the
 * coverage probe returns false.
 *
 * Bounded SQL: one `DISTINCT (medicationId, dayKey)` $queryRaw scan
 * over the trailing window, then one upsert per row. The dayKey is
 * computed in Postgres in the user's zone so we
 * don't have to ship millions of rows back to Node.
 */
export async function recomputeUserMedicationCompliance(
  userId: string,
  days: number = MEDICATION_COMPLIANCE_BACKFILL_DAYS,
  tz: string | null | undefined = null,
): Promise<{ rowsUpserted: number; durationMs: number }> {
  const startedAt = Date.now();
  const safeTz = safeTimezone(tz);

  const now = new Date();
  const oldestKey = userDayKey(
    new Date(now.getTime() - (days - 1) * 86_400_000),
    safeTz,
  );
  const oldestStart = startOfLocalDayKey(oldestKey, safeTz);

  // Distinct (medication_id, dayKey) pairs the user has any intake
  // event for inside the trailing window. `scheduled_for` is a naive UTC
  // timestamp: it is read as UTC first and only then shifted into the
  // user's zone. A single `AT TIME ZONE $tz` reads it as local time and
  // shifts it the wrong way, which keyed every slot within the zone's
  // offset of midnight onto the neighbouring day.
  const pairs = await prisma.$queryRaw<
    Array<{ medication_id: string; day: string }>
  >`
    SELECT DISTINCT
      "medication_id",
      to_char(
        ("scheduled_for" AT TIME ZONE 'UTC') AT TIME ZONE ${safeTz},
        'YYYY-MM-DD'
      ) AS "day"
    FROM "medication_intake_events"
    WHERE "user_id" = ${userId}
      AND "deleted_at" IS NULL
      AND "scheduled_for" >= ${oldestStart}
  `;

  let rowsUpserted = 0;
  for (const pair of pairs) {
    await recomputeMedicationComplianceForDay(
      userId,
      pair.medication_id,
      pair.day,
      safeTz,
    );
    rowsUpserted += 1;
  }

  return { rowsUpserted, durationMs: Date.now() - startedAt };
}

/**
 * v1.4.39 hotfix (QA F-SEC-M-01) — user-scoped enqueue helper for the
 * request-path coverage-miss fallback.
 *
 * Mirrors `ensureUserMoodRollupsFresh`: the route fires this when its
 * coverage probe returned false so the caller's account picks up a
 * targeted boot-backfill job, instead of running a cluster-wide
 * `LEFT JOIN` over `medication_intake_events × medication_compliance_rollups`
 * on every authenticated coverage-miss request. The cluster-wide scan
 * was a soft DoS amplifier — an authenticated user iterating
 * coverage-miss requests could drive a multi-tenant table scan on
 * every hit.
 *
 * The boot-time discovery helper below stays cluster-wide (it runs
 * once per worker boot, not per request).
 */
export async function enqueueUserMedicationComplianceBackfill(
  userId: string,
): Promise<{ enqueued: boolean; error: string | null }> {
  const boss = getGlobalBoss();
  if (!boss) {
    return { enqueued: false, error: null };
  }
  try {
    const payload: MedicationComplianceBackfillPayload = {
      userId,
      enqueuedAt: new Date().toISOString(),
    };
    const jobId = await boss.send(
      MEDICATION_COMPLIANCE_BACKFILL_QUEUE,
      payload,
      {
        retryLimit: 3,
        retryDelay: 60,
        retryBackoff: true,
        singletonKey: `medication-compliance-boot-backfill|${userId}`,
      },
    );
    return { enqueued: jobId !== null && jobId !== undefined, error: null };
  } catch (err) {
    return {
      enqueued: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Boot-time enqueue helper — mirrors v1.4.35.1
 * `enqueueBootTimeRollupBackfill`. Finds users with intake events but
 * zero compliance-rollup coverage for the trailing window and enqueues
 * one full-fold per account onto `MEDICATION_COMPLIANCE_BACKFILL_QUEUE`.
 *
 * Idempotent across reboots: once an account has at least one rollup
 * row inside the trailing window the discovery query drops them.
 * pg-boss `singletonKey` coalesces duplicate sends.
 */
export async function enqueueBootTimeMedicationComplianceBackfill(
  // Optional boot-storm stagger. When > 0 the per-user sends carry a
  // `startAfter` delay (seconds) so this full-history fold does not drain in
  // parallel with the other boot backfills onto one heavy tenant. Default 0
  // keeps immediate semantics for any non-boot caller.
  startAfterSeconds: number = 0,
): Promise<{
  enqueued: number;
  skipped: number;
  error: string | null;
}> {
  const boss = getGlobalBoss();
  if (!boss) {
    return { enqueued: 0, skipped: 0, error: null };
  }

  try {
    // Trailing window cutoff for the existence probe — `scheduled_for`
    // older than this is not what the read path consults.
    const cutoff = new Date(
      Date.now() - MEDICATION_COMPLIANCE_BACKFILL_DAYS * 86_400_000,
    );
    const users = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT DISTINCT mie."user_id" AS id
      FROM "medication_intake_events" mie
      LEFT JOIN "medication_compliance_rollups" r
        ON r."user_id" = mie."user_id"
       AND r."medication_id" = mie."medication_id"
      WHERE mie."scheduled_for" >= ${cutoff}
        AND mie."deleted_at" IS NULL
        AND r."day" IS NULL
    `;

    if (users.length === 0) {
      return { enqueued: 0, skipped: 0, error: null };
    }

    let enqueued = 0;
    let skipped = 0;
    for (const { id } of users) {
      const payload: MedicationComplianceBackfillPayload = {
        userId: id,
        enqueuedAt: new Date().toISOString(),
      };
      const jobId = await boss.send(
        MEDICATION_COMPLIANCE_BACKFILL_QUEUE,
        payload,
        {
          retryLimit: 3,
          retryDelay: 60,
          retryBackoff: true,
          singletonKey: `medication-compliance-boot-backfill|${id}`,
          ...(startAfterSeconds > 0 ? { startAfter: startAfterSeconds } : {}),
        },
      );
      if (jobId) {
        enqueued += 1;
      } else {
        skipped += 1;
      }
    }
    return { enqueued, skipped, error: null };
  } catch (err) {
    return {
      enqueued: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
