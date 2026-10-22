/**
 * The family history slice of the backup payload schema.
 *
 * Part of the family history backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { FamilyRelationship } from "@/generated/prisma/enums";
import { isoDateTime } from "@/lib/export/backup-schema-kit";

export const familyHistoryBackupSchema = z
  .object({
    id: z.string().min(1),
    relationship: z.enum(FamilyRelationship),
    condition: z.string().min(1),
    ageAtOnset: z.number().int().nullable().optional(),
    note: z.string().nullable().optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
