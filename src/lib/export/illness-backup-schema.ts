/**
 * The illness slice of the backup payload schema.
 *
 * Part of the illness backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import {
  IllnessLifecycle,
  IllnessType,
  Laterality,
} from "@/generated/prisma/enums";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";

export const illnessSymptomBackupSchema = z
  .object({
    key: z.string().min(1),
    severity: z.number().int().nullable().optional(),
  })
  .passthrough();
export const illnessDayLogBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    episodeId: z.string().min(1).optional(),
    date: z.string().min(1),
    functionalImpact: z.number().int().nullable().optional(),
    feverC: z.number().nullable().optional(),
    symptoms: z.array(illnessSymptomBackupSchema).default([]),
    note: z.string().nullable().optional(),
    updatedAt: isoDateTime.optional(),
    noteEncrypted: base64BytesSchema.nullable().optional(),
    tz: z.string().nullable().optional(),
    createdAt: isoDateTime.optional(),
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
export const illnessEpisodeBackupSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(IllnessType),
    lifecycle: z.enum(IllnessLifecycle),
    onsetAt: isoDateTime,
    resolvedAt: isoDateTime.nullable().optional(),
    // Self-referencing flare/exacerbation link, carried as the exported
    // episode's own id — never resolved against another user's rows.
    parentConditionId: z.string().nullable().optional(),
    note: z.string().nullable().optional(),
    createdAt: isoDateTime.optional(),
    noteEncrypted: base64BytesSchema.nullable().optional(),
    // The body site and side. Optional so a file written before
    // they existed still parses; the condition restores with neither. The
    // site rides as ciphertext in a disaster-recovery file and as plaintext
    // in a portable one, exactly like the note beside it.
    bodySite: z.string().max(200).nullable().optional(),
    bodySiteEncrypted: base64BytesSchema.nullable().optional(),
    laterality: z.enum(Laterality).nullable().optional(),
    deletedAt: isoDateTime.nullable().optional(),
    updatedAt: isoDateTime.optional(),
    dayLogs: z.array(illnessDayLogBackupSchema).default([]),
  })
  .passthrough();
