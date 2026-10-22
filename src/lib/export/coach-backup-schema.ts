/**
 * The coach slice of the backup payload schema.
 *
 * Part of the coach backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { TRAIL_MAX_BYTES } from "@/lib/ai/coach/activity/contract";
import { RESULTS_MAX_BYTES } from "@/lib/ai/coach/results/refs";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";

/**
 * A turn's stored tables, bounded at restore. The live path never stores more
 * than `RESULTS_MAX_BYTES` of table JSON per turn (`fitResultsToStorage`), so
 * a file this release writes always fits; a larger value is a damaged or
 * crafted file, refused with the rest of it like any other malformed field
 * rather than sealed into the database unbounded. The sealed form is the
 * ciphertext of at most that much JSON, base64-encoded in the file: about
 * 1.8 times the plaintext, so twice the plaintext bound caps it.
 */
export const COACH_RESULTS_SEALED_MAX_CHARS = 2 * RESULTS_MAX_BYTES;
export const coachResultsJsonSchema = z
  .string()
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= RESULTS_MAX_BYTES,
    { message: `Coach result tables exceed ${RESULTS_MAX_BYTES} bytes` },
  );
export const coachResultsSealedSchema = base64BytesSchema.refine(
  (value) => value.length <= COACH_RESULTS_SEALED_MAX_CHARS,
  { message: "Coach result tables exceed the stored size" },
);
/** The trail's model text, bounded at restore like the tables above. */
export const COACH_TRAIL_SEALED_MAX_CHARS = 2 * TRAIL_MAX_BYTES;
export const coachTrailJsonSchema = z
  .string()
  .refine(
    (value) => new TextEncoder().encode(value).byteLength <= TRAIL_MAX_BYTES,
    { message: `Coach trail exceeds ${TRAIL_MAX_BYTES} bytes` },
  );
export const coachTrailSealedSchema = base64BytesSchema.refine(
  (value) => value.length <= COACH_TRAIL_SEALED_MAX_CHARS,
  { message: "Coach trail exceeds the stored size" },
);
/**
 * One Coach turn.
 *
 * `contentEncrypted` and `content` are the two ends of the same contract, so
 * both are optional here and exactly one arrives: a disaster-recovery file
 * carries the ciphertext, a portable file carries the prose. Requiring either
 * would refuse half the valid files; requiring both would refuse all of them.
 * The restore picks whichever it was handed.
 */
export const coachMessageBackupSchema = z
  .object({
    id: z.string().min(1),
    role: z.string().min(1),
    contentEncrypted: base64BytesSchema.optional(),
    content: z.string().optional(),
    metricSourceJson: z.string().nullable().optional(),
    providerType: z.string().nullable().optional(),
    promptVersion: z.string().nullable().optional(),
    tokensUsed: z.number().int().nullable().optional(),
    model: z.string().nullable().optional(),
    // The turn's tables: ciphertext on a disaster-recovery file,
    // readable JSON on a portable one, absent on every file written before.
    resultsEncrypted: coachResultsSealedSchema.nullable().optional(),
    resultsJson: coachResultsJsonSchema.nullable().optional(),
    // The trail's model text, the same two ends as the tables.
    trailEncrypted: coachTrailSealedSchema.nullable().optional(),
    trailJson: coachTrailJsonSchema.nullable().optional(),
    createdAt: isoDateTime,
  })
  .passthrough();
export const coachConversationDocumentBackupSchema = z
  .object({
    documentId: z.string().min(1),
    addedAt: isoDateTime,
  })
  .passthrough();
export const coachConversationBackupSchema = z
  .object({
    id: z.string().min(1),
    // A portable file (and every file written before) carries the
    // readable title; a disaster-recovery file carries only the ciphertext.
    title: z.string().optional(),
    titleEncrypted: base64BytesSchema.optional(),
    // NOT optional with a default. The fence is permanent and a file that does
    // not state it is a file that cannot be trusted to re-fence the
    // conversation, so the absence has to be visible rather than defaulted to
    // the permissive value.
    documentScoped: z.boolean(),
    summaryEncrypted: base64BytesSchema.nullable().optional(),
    summary: z.string().nullable().optional(),
    summaryUpdatedAt: isoDateTime.nullable().optional(),
    summaryTurnCount: z.number().int().min(0).optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    messages: z.array(coachMessageBackupSchema).default([]),
    attachments: z.array(coachConversationDocumentBackupSchema).default([]),
  })
  .passthrough();
/**
 * The Coach's memory. `deletedAt` is optional rather than nullable-required:
 * a portable file omits tombstoned rows entirely and never states the field,
 * while a disaster-recovery file always does.
 */
export const coachFactBackupSchema = z
  .object({
    id: z.string().min(1),
    factEncrypted: base64BytesSchema.optional(),
    fact: z.string().optional(),
    category: z.string().min(1),
    confidence: z.number().int().min(0).max(100).optional(),
    sourceConversationId: z.string().nullable().optional(),
    // Absent on every file written before; restored at the column
    // defaults then.
    source: z.string().min(1).max(32).optional(),
    lastUsedAt: isoDateTime.nullable().optional(),
    sourceMessageId: z.string().nullable().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
export const coachPlanBackupSchema = z
  .object({
    id: z.string().min(1),
    metric: z.string().min(1),
    ifCueEncrypted: base64BytesSchema.optional(),
    ifCue: z.string().optional(),
    thenActionEncrypted: base64BytesSchema.optional(),
    thenAction: z.string().optional(),
    targetEncrypted: base64BytesSchema.nullable().optional(),
    target: z.string().nullable().optional(),
    outcomeEncrypted: base64BytesSchema.nullable().optional(),
    outcome: z.string().nullable().optional(),
    status: z.string().optional(),
    reviewDate: isoDateTime.nullable().optional(),
    sourceConversationId: z.string().nullable().optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
export const coachReminderBackupSchema = z
  .object({
    id: z.string().min(1),
    noteEncrypted: base64BytesSchema.optional(),
    note: z.string().optional(),
    metric: z.string().nullable().optional(),
    relatedPlanId: z.string().nullable().optional(),
    triggerKind: z.string().optional(),
    dueAt: isoDateTime.nullable().optional(),
    contextCue: z.string().nullable().optional(),
    status: z.string().optional(),
    source: z.string().min(1),
    sourceConversationId: z.string().nullable().optional(),
    lastSurfacedAt: isoDateTime.nullable().optional(),
    surfaceCount: z.number().int().min(0).optional(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
