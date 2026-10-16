/**
 * v1.18.6 — resumable module-tour progress.
 *
 * Pure data + Zod schema for the `users.onboarding_tour_progress_json`
 * column. Kept DOM-free + free of Prisma imports so vitest (node env)
 * and the OpenAPI registry can both consume it.
 *
 * The coarse `onboardingTourCompleted` boolean stays the launcher's
 * auto-launch gate; this object is the fine-grained resume point so a
 * mid-tour reload reopens at the right module. `null` = the user has
 * not started the module tour.
 */

import { z } from "zod/v4";
import { isoDateTime } from "@/lib/validations/datetime";

/** Terminal / running status of the module tour. */
export const TOUR_PROGRESS_STATUSES = [
  "in_progress",
  "completed",
  "skipped",
] as const;

/**
 * The persisted progress shape. `lastStopId` seeds the resume index;
 * `completedStopIds` is informational (analytics + future per-module
 * "already seen" hints). Stop ids are bounded strings — the client
 * sends a known stop id from `buildTourStops()`, but the server does
 * not couple to that closed set (a future stop must not 422 an older
 * client and vice-versa), so the field is a length-capped string array
 * rather than a hard enum.
 */
export const tourProgressSchema = z.object({
  lastStopId: z.string().min(1).max(64).nullable(),
  completedStopIds: z.array(z.string().min(1).max(64)).max(64).default([]),
  status: z.enum(TOUR_PROGRESS_STATUSES),
  updatedAt: isoDateTime({ offset: false }),
});

export type TourProgress = z.infer<typeof tourProgressSchema>;

/**
 * Parse a value read from the JSON column. Returns `null` for a null /
 * absent column AND for any malformed payload — the resume point is a
 * non-critical convenience, so a corrupt blob degrades to "start from
 * the top" rather than throwing into the auth/me read path.
 */
export function parseTourProgress(value: unknown): TourProgress | null {
  if (value == null) return null;
  const parsed = tourProgressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
