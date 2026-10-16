/**
 * Allergy / intolerance request/response validation (v1.25, W-RECORDS).
 *
 * Source of truth for the `/api/allergies/*` wire contract. The Zod schemas
 * here are reused by the OpenAPI registry so the spec stays single-source.
 * `userId` is NEVER a body field — it is narrowed from the session/Bearer in
 * every route and fed to the Prisma `where`.
 *
 * A structured AllergyIntolerance-style RECORD (not a time-series signal):
 * `substance` is the queryable human label; the free-text reaction
 * description + notes are encrypted at rest (`reactionEncrypted` /
 * `notesEncrypted` Bytes columns). Patient-reported — never a clinical
 * diagnosis the app asserts.
 */
import { z } from "zod/v4";
import { isPlausibleEntryInstant } from "@/lib/validations/entry-instant";
import { isoDateTime } from "@/lib/validations/datetime";

/**
 * Plausible-instant bound shared with the measurement / illness paths: no
 * future instant beyond the 5-min skew, no instant before 1900. Stays a
 * string on the wire (iOS reads it back verbatim).
 */
const boundedInstant = isoDateTime().refine(
  (s) => isPlausibleEntryInstant(new Date(s)),
  {
    message: "must be a plausible instant (not future, not pre-1900)",
  },
);

/* ── enums (mirror the Prisma enums) ─────────────────────────────── */

export const allergyCategoryEnum = z.enum([
  "FOOD",
  "MEDICATION",
  "ENVIRONMENT",
  "BIOLOGIC",
  "OTHER",
]);

export const allergyTypeEnum = z.enum(["ALLERGY", "INTOLERANCE"]);

export const allergySeverityEnum = z.enum(["MILD", "MODERATE", "SEVERE"]);

export const allergyStatusEnum = z.enum(["ACTIVE", "INACTIVE", "RESOLVED"]);

/* ── CRUD ─────────────────────────────────────────────────────────── */

/**
 * Create an allergy. `substance` is the user-facing allergen name; the
 * free-text `reaction` + `note` are encrypted at rest. `onsetAt` is optional
 * (unknown when omitted).
 */
export const allergyCreateSchema = z.object({
  substance: z.string().min(1).max(160),
  category: allergyCategoryEnum.optional().default("OTHER"),
  type: allergyTypeEnum.optional().default("ALLERGY"),
  severity: allergySeverityEnum.nullable().optional(),
  status: allergyStatusEnum.optional().default("ACTIVE"),
  onsetAt: boundedInstant.nullable().optional(),
  reaction: z.string().max(2000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export type AllergyCreate = z.infer<typeof allergyCreateSchema>;

/**
 * Edit an allergy — every field optional; an omitted field is left
 * untouched. Rejects unknown keys.
 */
export const allergyUpdateSchema = z
  .object({
    substance: z.string().min(1).max(160).optional(),
    category: allergyCategoryEnum.optional(),
    type: allergyTypeEnum.optional(),
    severity: allergySeverityEnum.nullable().optional(),
    status: allergyStatusEnum.optional(),
    onsetAt: boundedInstant.nullable().optional(),
    reaction: z.string().max(2000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .strict();

export type AllergyUpdate = z.infer<typeof allergyUpdateSchema>;

/** History/list query — newest-first, bounded. */
export const allergyListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  includeInactive: z.union([z.literal("true"), z.literal("false")]).optional(),
});

export type AllergyListQuery = z.infer<typeof allergyListQuerySchema>;
