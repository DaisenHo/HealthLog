/**
 * The health score slice of the backup payload schema.
 *
 * Part of the health score backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { isoDateTime } from "@/lib/export/backup-schema-kit";

export const healthScoreRecordBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    dayKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    // The zone the day was cut on. An account that moved zones has days of
    // different lengths behind it, and a restore that guessed would make them
    // look comparable.
    timezone: z.string().min(1),
    composite: z.number().int().min(0).max(100),
    // The same closed set the column's CHECK constraint carries. A band the
    // schema let through and the database refused would fail the whole
    // restore transaction on one bad row.
    band: z.enum(["green", "yellow", "red"]),
    scoreVersion: z.number().int(),
    composition: z.array(z.string().min(1)).min(1),
    pillarScores: z.record(z.string(), z.number()),
    inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    configVersion: z.number().int().nullable().default(null),
    configChangedAt: isoDateTime.nullable().default(null),
    computedAt: isoDateTime,
    createdAt: isoDateTime.optional(),
  })
  .passthrough();
