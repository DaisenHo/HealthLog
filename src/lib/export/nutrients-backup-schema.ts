/**
 * The nutrients slice of the backup payload schema.
 *
 * Part of the nutrients backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * A day's total for one nutrient, from one source.
 *
 * The export has written these since v1.29 and the canonical schema never
 * declared them, so `.passthrough()` carried the key through parsing and no
 * reader ever looked at it. The restore therefore dropped every water and
 * vitamin total on the floor while reporting success.
 */
export const nutrientDaySchema = z
  .object({
    day: z.string().min(1),
    nutrient: z.string().min(1),
    amount: z.number(),
    unit: z.string().min(1),
    // Closed set in app code rather than a DB enum; kept as a string here so a
    // future source does not make an old file unparseable.
    source: z.string().min(1),
    // Absent from files written before v1.39.7.
    externalSourceVersion: z.string().nullable().optional(),
    createdAt: isoDateTime.optional(),
    // Disaster-recovery files only; without it the day is stamped with the
    // restore, as before.
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
