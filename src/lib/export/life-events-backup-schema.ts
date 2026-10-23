/**
 * The life events slice of the backup payload schema.
 *
 * Part of the life events backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import {
  LifeEventCategory,
  LifeEventPrecision,
} from "@/generated/prisma/enums";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * A life event (v1.42, #613). `title` / `titleEncrypted` and `note` /
 * `noteEncrypted` are the two ends of the free-text contract: a portable file
 * carries the plaintext, a disaster-recovery file the ciphertext and the
 * tombstone. Dates are calendar strings.
 */
export const lifeEventBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    category: z.enum(LifeEventCategory),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    precision: z.enum(LifeEventPrecision),
    title: z.string().min(1).optional(),
    titleEncrypted: base64BytesSchema.optional(),
    note: z.string().nullable().optional(),
    noteEncrypted: base64BytesSchema.nullable().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough()
  .refine((e) => e.title !== undefined || e.titleEncrypted !== undefined, {
    message: "A life event needs a title or its ciphertext",
  });
