/**
 * Activity goals a person sets for themselves (D1036).
 *
 * Stored in `User.activityGoalsJson`. Every goal is optional and a `null`
 * clears it; an account that never set one stores nothing and reads as "no
 * goals". The calendar reports progress against the goals that are set and
 * says nothing about the ones that are not: there is no default goal and no
 * population norm here, only the person's own number.
 *
 * The keys and bounds live in `src/lib/activity/goal-bounds.ts` so the
 * browser can read them without the schema.
 */
import { z } from "zod/v4";

import {
  ACTIVITY_GOAL_BOUNDS,
  ACTIVITY_GOAL_KEYS,
  type ActivityGoalKey,
} from "@/lib/activity/goal-bounds";

export { ACTIVITY_GOAL_BOUNDS, ACTIVITY_GOAL_KEYS, type ActivityGoalKey };

function goalField(key: ActivityGoalKey) {
  const { min, max } = ACTIVITY_GOAL_BOUNDS[key];
  return z.number().int().min(min).max(max).nullable().optional();
}

/** The stored shape and the PATCH body: every key optional, `null` clears. */
export const activityGoalsSchema = z
  .object({
    workoutsPerWeek: goalField("workoutsPerWeek").describe(
      "Workouts per week (Monday to Sunday). `null` clears the goal.",
    ),
    activeMinutesPerWeek: goalField("activeMinutesPerWeek").describe(
      "Active minutes per week: the larger of the day's exercise minutes and the day's workout minutes, summed over the week. `null` clears the goal.",
    ),
    stepsPerWeek: goalField("stepsPerWeek").describe(
      "Steps per week. `null` clears the goal.",
    ),
    stepsPerMonth: goalField("stepsPerMonth").describe(
      "Steps per calendar month. `null` clears the goal.",
    ),
  })
  .strict();

export type ActivityGoalsInput = z.infer<typeof activityGoalsSchema>;

/** The resolved goals: every key present, `null` = not set. */
export type ActivityGoals = Record<ActivityGoalKey, number | null>;

export const NO_ACTIVITY_GOALS: ActivityGoals = {
  workoutsPerWeek: null,
  activeMinutesPerWeek: null,
  stepsPerWeek: null,
  stepsPerMonth: null,
};

/**
 * Read a stored value. Anything that does not parse (a hand-edited row, a
 * shape from a future release) reads key by key: a valid goal survives, an
 * invalid one reads as not set. Never throws.
 */
export function parseActivityGoals(raw: unknown): ActivityGoals {
  const out: ActivityGoals = { ...NO_ACTIVITY_GOALS };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return out;
  }
  const record = raw as Record<string, unknown>;
  for (const key of ACTIVITY_GOAL_KEYS) {
    const parsed = goalField(key).safeParse(record[key]);
    if (parsed.success && typeof parsed.data === "number") {
      out[key] = parsed.data;
    }
  }
  return out;
}

/**
 * Apply a validated PATCH to the stored goals: a key the body names replaces
 * the stored value (`null` clears it), a key it leaves out stays as it was.
 * Built key by key, never by spreading the body.
 */
export function mergeActivityGoals(
  current: ActivityGoals,
  patch: ActivityGoalsInput,
): ActivityGoals {
  const next: ActivityGoals = { ...current };
  for (const key of ACTIVITY_GOAL_KEYS) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  return next;
}

/** True when no goal is set, so the column can go back to null. */
export function hasNoActivityGoals(goals: ActivityGoals): boolean {
  return ACTIVITY_GOAL_KEYS.every((key) => goals[key] === null);
}
