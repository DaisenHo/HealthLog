/**
 * v1.18.1 — request body for the Coach cadence-suggestion
 * action endpoint (`POST /api/coach/reminder-suggestions`).
 *
 * The client sends ONLY the cadence id and the action it took; the server
 * resolves the actual cadence (metric + schedule + course window) from the
 * closed catalog, so the client can never widen a cadence or inject a
 * schedule.
 *
 *   - `accept`  → create a `MeasurementReminder` with `origin: COACH`.
 *   - `dismiss` → record dismissal memory (never re-suggest this cadence).
 *   - `stop`    → the explicit "you measure enough — stop" path (suppress
 *                 every future cadence suggestion until re-enabled).
 */
import { z } from "zod/v4";

export const coachReminderSuggestionActionSchema = z.object({
  cadenceId: z.string().trim().min(1).max(64),
  action: z.enum(["accept", "dismiss", "stop"]),
});

export type CoachReminderSuggestionAction = z.infer<
  typeof coachReminderSuggestionActionSchema
>;
