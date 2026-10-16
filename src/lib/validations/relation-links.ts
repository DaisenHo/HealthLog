/**
 * v1.43 — the relation links that close the relation matrix. Same body and
 * answer as the existing link routes (`{ targetKind, targetIds }` in,
 * `{ changed, unknown }` out).
 */
import { z } from "zod/v4";

const targetIds = z.array(z.string().trim().min(1).max(64)).min(1).max(100);

/** `POST/DELETE /api/medications/{id}/links`. */
export const MEDICATION_LINK_TARGETS = [
  "conditionEpisode",
  "document",
  "encounter",
] as const;
export const medicationLinkSchema = z.strictObject({
  targetKind: z.enum(MEDICATION_LINK_TARGETS),
  targetIds,
});
export type MedicationLinkInput = z.infer<typeof medicationLinkSchema>;

/** `POST/DELETE /api/labs/{id}/links`. */
export const LAB_RESULT_LINK_TARGETS = ["document", "encounter"] as const;
export const labResultLinkSchema = z.strictObject({
  targetKind: z.enum(LAB_RESULT_LINK_TARGETS),
  targetIds,
});
export type LabResultLinkInput = z.infer<typeof labResultLinkSchema>;

/** `related[]` on the six detail responses. */
export const RELATED_KINDS = [
  "labResult",
  "encounter",
  "document",
  "conditionEpisode",
  "medication",
  "vaccination",
] as const;
export const RELATED_VIA = ["direct", "encounter", "efficacyTarget"] as const;
