/**
 * Query keys — the activity calendar and activity goals (D1036).
 * Part of the centralized factory; aggregated in `./index.ts`.
 */
export const activityKeys = {
  /** Root of every activity-calendar cell; a goal save invalidates it. */
  activityCalendarAll: () => ["activity-calendar"] as const,
  activityCalendar: (period: "week" | "month", date: string | null) =>
    ["activity-calendar", period, date ?? "today"] as const,
  activityGoals: () => ["activity-goals"] as const,
};
