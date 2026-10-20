-- Where an unfinished Strava backfill picks up.
--
-- One backfill run reads at most forty pages of a hundred activities. A
-- longer history ended the run as incomplete without a note of how far it
-- got, so every boot read the same newest forty pages again, up to 190 of
-- the 200 requests the whole instance may make in fifteen minutes, and the
-- older history was never reached. The column holds the start of the oldest
-- activity the last run read; the next run asks for activities before it.
-- Nullable and unset for every existing row: an unfinished backfill starts
-- once more from the newest page and records its place from then on.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "strava_backfill_resume_before" TIMESTAMP(3);
