/**
 * The profile slice of the backup payload schema.
 *
 * Part of the profile backup domain, beside its export and restore.
 * Loaded only through `src/lib/validations/backup.ts`, which composes every
 * slice into `backupPayloadSchema` on first use (the schema is ~12 MB of
 * heap; see `backup-schema-lazy-guard.test.ts`).
 */
import { z } from "zod/v4";
import { base64BytesSchema, isoDateTime } from "@/lib/export/backup-schema-kit";
import {
  advanceDirectiveStatusSchema,
  emergencyBloodTypeSchema,
  organDonorStatusSchema,
} from "@/lib/validations/emergency-profile";
import {
  DEFAULT_HEALTH_PROFILE_AI_SECTIONS,
  storedHealthProfileAiSectionSchema,
} from "@/lib/validations/health-profile-facts";
import {
  STORED_FACT_KINDS,
  isStoredFactPlaintext,
} from "@/lib/validations/life-circumstances";

/**
 * The account's durable self-context — one row per user.
 *
 * Portable exports carry the decrypted free text; disaster-recovery payloads
 * carry the AES-256-GCM envelopes as base64 and leave the plaintext fields
 * null. The restore prefers ciphertext when the file has it and re-encrypts
 * the plaintext otherwise, which is the same contract the lab note uses.
 */
export const healthProfileBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    aboutMe: z.string().nullable().default(null),
    conditions: z.string().nullable().default(null),
    allergies: z.string().nullable().default(null),
    coachFocus: z.string().nullable().default(null),
    // Every stored section, the four life-circumstance ones included (v1.43):
    // a file written by an account that opted one in must restore it opted in.
    aiIncludedSections: z
      .array(storedHealthProfileAiSectionSchema)
      .default([...DEFAULT_HEALTH_PROFILE_AI_SECTIONS]),
    // Section confirmations, section key to ISO instant.
    // Carried as stored; the read route judges each stamp, so an unreadable
    // one costs a "still true?" prompt rather than the whole restore.
    lifeConfirmedJson: z
      .record(z.string().max(64), z.string().max(64))
      .nullable()
      .optional(),
    // Emergency profile: three plaintext enums (carried by value in both
    // purposes), three free-text columns following the ciphertext-or-plaintext
    // split of the self-context fields above.
    emergencyBloodType: emergencyBloodTypeSchema.nullable().default(null),
    organDonorStatus: organDonorStatusSchema.nullable().default(null),
    advanceDirectiveStatus: advanceDirectiveStatusSchema
      .nullable()
      .default(null),
    emergencyContacts: z.string().nullable().default(null),
    emergencyImplants: z.string().nullable().default(null),
    emergencyNote: z.string().nullable().default(null),
    emergencyContactsEncrypted: base64BytesSchema.nullable().optional(),
    emergencyImplantsEncrypted: base64BytesSchema.nullable().optional(),
    emergencyNoteEncrypted: base64BytesSchema.nullable().optional(),
    aboutMeEncrypted: base64BytesSchema.nullable().optional(),
    conditionsEncrypted: base64BytesSchema.nullable().optional(),
    allergiesEncrypted: base64BytesSchema.nullable().optional(),
    coachFocusEncrypted: base64BytesSchema.nullable().optional(),
    pendingQuestionsEncrypted: base64BytesSchema.nullable().optional(),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
export const healthProfileFactBackupSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(STORED_FACT_KINDS),
    value: z.string().nullable().default(null),
    valueEncrypted: base64BytesSchema.optional(),
    validFrom: isoDateTime,
    validUntil: isoDateTime.nullable(),
    provenance: z.enum(["USER_REPORTED", "USER_CORRECTION"]),
    supersededByRevisionId: z.string().min(1).nullable(),
    createdAt: isoDateTime,
  })
  .passthrough()
  .superRefine((fact, ctx) => {
    if (fact.valueEncrypted === undefined) {
      if (
        fact.value === null ||
        !isStoredFactPlaintext(fact.kind, fact.value)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["value"],
          message: "A portable profile fact requires a valid readable value",
        });
      }
    }
    if (
      fact.validUntil !== null &&
      Date.parse(fact.validUntil) <= Date.parse(fact.validFrom)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "validUntil must be later than validFrom",
      });
    }
  });
/** One reading of a user-defined metric, nested under the metric that owns it. */
export const customMetricEntryBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    value: z.number(),
    unit: z.string().min(1),
    measuredAt: isoDateTime,
    note: z.string().nullable().default(null),
    /// The note's ciphertext, DR payloads only.
    noteEncrypted: base64BytesSchema.nullable().optional(),
    createdAt: isoDateTime.optional(),
    /// The entry tombstone rides DR payloads so a restore
    /// brings the account back exactly as it stood, undo affordance included.
    deletedAt: isoDateTime.nullable().optional(),
  })
  .passthrough();
/**
 * A metric the account defined itself.
 *
 * The one class of series no integration can ever re-sync: nobody else has the
 * definition and nobody else has the readings. It was classified as carried
 * from the day the backup plan was written and carried by nothing, so a
 * restore rebuilt the account without it and reported success.
 *
 * Readings are nested rather than flat-with-a-name-reference so the restore
 * has no parent to look up and therefore no lookup to miss.
 */
export const customMetricBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1),
    unit: z.string().min(1),
    targetLow: z.number().nullable().default(null),
    targetHigh: z.number().nullable().default(null),
    decimals: z.number().int().nullable().default(null),
    description: z.string().nullable().default(null),
    correlationEnabled: z.boolean().default(false),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
    deletedAt: isoDateTime.nullable().optional(),
    entries: z.array(customMetricEntryBackupSchema).default([]),
  })
  .passthrough();
export const correlationPatternBackupSchema = z
  .object({
    id: z.string().min(1).optional(),
    canonicalKey: z.string().regex(/^p1:[a-f0-9]{64}$/),
    family: z.string().min(1),
    factorKey: z.string().min(1),
    outcomeKey: z.string().min(1),
    lagDays: z.number().int().min(0),
    sampleSize: z.number().int().positive(),
    effectSize: z.number().finite(),
    pValue: z.number().min(0).max(1),
    qValue: z.number().min(0).max(1).nullable().default(null),
    evidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
    isCurrent: z.boolean(),
    lastComputedAt: isoDateTime,
    dismissedAt: isoDateTime.nullable().default(null),
    dismissedEvidenceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .default(null),
    dismissedEffectSize: z.number().finite().nullable().default(null),
    dismissedSampleSize: z.number().int().positive().nullable().default(null),
    createdAt: isoDateTime.optional(),
    updatedAt: isoDateTime.optional(),
  })
  .passthrough();
