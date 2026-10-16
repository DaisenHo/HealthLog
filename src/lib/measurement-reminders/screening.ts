/**
 * v1.27.6 — the reminder types that are SCREENINGS, not numeric readings.
 * Every surface with a per-reminder primary action branches on this: a
 * screening routes to the check-in page (`/mental-wellbeing`) instead of
 * opening the numeric MeasurementForm — a score is never typed in, it
 * falls out of a completed test (which then auto-satisfies the reminder).
 *
 * Plain data in its own module, apart from
 * `@/lib/validations/measurement-reminders`, so the dashboard's Vorsorge card
 * can branch on it without pulling Zod into the dashboard's first load.
 */
const SCREENING_REMINDER_TYPES: ReadonlySet<string> = new Set([
  "PHQ9_SCORE",
  "GAD7_SCORE",
  "WHO5_SCORE",
  "SCI_SCORE",
]);

/** Whether a reminder's `measurementType` targets a screening check-in. */
export function isScreeningReminderType(
  type: string | null | undefined,
): boolean {
  return type != null && SCREENING_REMINDER_TYPES.has(type);
}
