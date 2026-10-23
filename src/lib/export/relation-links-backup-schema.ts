/**
 * The relation links slice of the backup payload schema.
 *
 * Part of the relation links backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * One row of a relation link table: its two ends, by the column
 * names of the table, and the instant it was filed.
 */
export function relationLinkBackupSchema<A extends string, B extends string>(
  a: A,
  b: B,
) {
  return z
    .object({
      [a]: z.string().min(1),
      [b]: z.string().min(1),
      createdAt: isoDateTime,
    } as { [K in A | B]: z.ZodString } & { createdAt: typeof isoDateTime })
    .passthrough();
}
