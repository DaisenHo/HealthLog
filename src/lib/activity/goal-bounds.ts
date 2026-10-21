/**
 * The activity-goal keys and their bounds, without a schema library, so the
 * goals sheet can read them in the browser. The schema that enforces them
 * on the server is `src/lib/validations/activity-goals.ts`.
 */
export const ACTIVITY_GOAL_KEYS = [
  "workoutsPerWeek",
  "activeMinutesPerWeek",
  "stepsPerWeek",
  "stepsPerMonth",
] as const;

export type ActivityGoalKey = (typeof ACTIVITY_GOAL_KEYS)[number];

/**
 * Wide on purpose: they refuse typing mistakes (a goal of 5 000 000 steps a
 * week), they do not judge what a sensible goal is.
 */
export const ACTIVITY_GOAL_BOUNDS: Record<
  ActivityGoalKey,
  { min: number; max: number }
> = {
  workoutsPerWeek: { min: 1, max: 28 },
  activeMinutesPerWeek: { min: 10, max: 5000 },
  stepsPerWeek: { min: 1000, max: 700_000 },
  stepsPerMonth: { min: 1000, max: 3_000_000 },
};
