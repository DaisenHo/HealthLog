-- Where the Oura history backfill has got, and when it finished.
--
-- The backfill reads every Oura collection's history in slices through the
-- shared integration backfill lane. After each window it writes, the progress
-- note records where the collection's next window ends, so a slice that stops
-- on its budget or a rate limit resumes there instead of from the newest day.
-- The completion stamp drops the account from boot discovery.
--
-- Both nullable and unset for every existing row: every current Oura
-- connection is offered the backfill at the next boot, with no reconnect.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oura_backfill_progress" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oura_backfill_completed_at" TIMESTAMP(3);
