/**
 * The intraday profile slice of the backup payload schema.
 *
 * Part of the intraday profile backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { MeasurementType } from "@/generated/prisma/enums";
import { isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * One local day's cumulative curve for one metric.
 *
 * The drain writes this row and deletes the per-sample rows it was folded from
 * in the same transaction, so past the grace window the file is the only copy.
 * `hourlyCumulative` is left unconstrained in length here on purpose: the
 * restore checks it against the slot count it shares with the reader and
 * throws naming the day, which says what is wrong with one row instead of
 * making a whole file unparseable.
 */
export const intradayProfileBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    type: z.enum(MeasurementType),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    hourlyCumulative: z.array(z.number()),
    dayTotal: z.number(),
    sampleCount: z.number().int(),
    // The hours the phone posted, what the curve was built
    // from, and how many hours there were. Defaulted so a file written before
    // the hours existed restores as a fold of single samples, which it was.
    hourlyIncrements: z.array(z.number()).default([]),
    basis: z.enum(["PER_SAMPLE", "HOUR_BUCKETS"]).default("PER_SAMPLE"),
    bucketCount: z.number().int().nonnegative().nullable().default(null),
    // The zone the day was cut on. The reader compares it against the
    // account's current zone and drops the mismatched days, so a restore that
    // dropped this column would make old curves look comparable when their
    // hours mean something else.
    timezone: z.string().min(1),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
