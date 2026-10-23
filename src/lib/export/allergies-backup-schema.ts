/**
 * The allergies slice of the backup payload schema.
 *
 * Part of the allergies backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import {
  AllergyCategory,
  AllergySeverity,
  AllergyStatus,
  AllergyType,
} from "@/generated/prisma/enums";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";

export const allergyBackupSchema = z
  .object({
    id: z.string().min(1),
    substance: z.string().min(1),
    category: z.enum(AllergyCategory),
    type: z.enum(AllergyType),
    severity: z.enum(AllergySeverity).nullable().optional(),
    status: z.enum(AllergyStatus),
    onsetAt: isoDateTime.nullable().optional(),
    reaction: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    createdAt: isoDateTime.optional(),
    reactionEncrypted: base64BytesSchema.nullable().optional(),
    notesEncrypted: base64BytesSchema.nullable().optional(),
    deletedAt: isoDateTime.nullable().optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
