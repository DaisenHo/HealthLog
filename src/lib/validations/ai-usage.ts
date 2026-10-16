/**
 * v1.43 (#1217) — AI usage in three levels.
 *
 * The wire spells a level in lower case; the database enum (`AiUsageLevel`)
 * in upper case. The order of {@link AI_USAGE_LEVELS} is the ceiling order:
 * a level is allowed when it is at or below the operator's `maxLevel`.
 */
import { z } from "zod/v4";

export const AI_USAGE_LEVELS = ["frugal", "standard", "full"] as const;
export type AiUsageLevelWire = (typeof AI_USAGE_LEVELS)[number];

export const aiUsageLevelSchema = z.enum(AI_USAGE_LEVELS);

/** `PUT /api/auth/me/ai-usage`: the account's own choice; `null` follows the instance default. */
export const aiUsagePutSchema = z.strictObject({
  level: aiUsageLevelSchema.nullable(),
});
export type AiUsagePutInput = z.infer<typeof aiUsagePutSchema>;

/** The `aiUsage` block of `PUT /api/admin/settings/assistant-flags`. */
export const adminAiUsageSchema = z.strictObject({
  maxLevel: aiUsageLevelSchema,
  defaultLevel: aiUsageLevelSchema,
  syncRegenGapHours: z.number().int().min(1).max(48).nullable(),
});
export type AdminAiUsageInput = z.infer<typeof adminAiUsageSchema>;
