-- Nobody who already keeps workout tracks loses them with 0432's opt-in.
--
-- 0432 added `users.store_workout_routes`, off by default. An account that
-- already holds at least one stored track has been syncing routes all along;
-- for it the setting starts ON, so its tracks keep arriving after the
-- upgrade. Only accounts without any stored track start OFF. Runs once, at
-- the upgrade; a person who turns it off afterwards stays off.
UPDATE "users" AS u
SET "store_workout_routes" = true
WHERE EXISTS (
  SELECT 1
  FROM "workout_routes" AS r
  JOIN "workouts" AS w ON w."id" = r."workout_id"
  WHERE w."user_id" = u."id"
);

-- Cursor of the one-time climb backfill (`src/lib/workouts/climb-backfill.ts`):
-- workouts stored before this release with a track but no elevation get their
-- metres climbed from the track, in id order, resumable across restarts.
-- NULL = not started, 'done' = finished.
ALTER TABLE "app_settings" ADD COLUMN IF NOT EXISTS "workout_climb_backfill_cursor" TEXT;
