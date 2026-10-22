-- Optional per-user activity goals for the activity calendar: workouts,
-- active minutes and steps per week, steps per month.
--
-- Nullable, no default, no backfill: null reads as "no goal set", which is
-- every account's state today.
--
-- Reversibility: dropping the column removes the goals; nothing else reads it.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "activity_goals_json" JSONB;
