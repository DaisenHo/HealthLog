-- A per-account opt-in for keeping workout GPS tracks. Off by default: a
-- route shows where a person lives, works and trains, so new tracks are
-- stored only once the person turns this on. Tracks already stored stay
-- where they are; the setting decides what new syncs and imports keep.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "store_workout_routes" BOOLEAN NOT NULL DEFAULT false;
