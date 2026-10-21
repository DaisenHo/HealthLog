-- Drop the readable copy of the cached AI insights payload.
--
-- Since 0411 every write goes to `insights_cached_text_encrypted` and leaves
-- `insights_cached_text` NULL, and the boot-time free-text encryption backfill
-- sealed the rows written before. Nothing reads the readable column any more.
--
-- A host that skipped the releases between 0411 and this one may still hold a
-- readable payload the backfill never reached. It is a cache of model output,
-- not a record: the next nightly or on-demand warm writes a fresh, sealed one.
-- Dropping it is the safe direction; keeping it would leave health text in the
-- clear on exactly the hosts that upgraded the longest way round.

DROP INDEX IF EXISTS "users_insights_cached_text_backfill_idx";

ALTER TABLE "users" DROP COLUMN IF EXISTS "insights_cached_text";

-- A row whose only copy of the payload was the readable one now holds no
-- cached text at all, while its stamp still says the cache is fresh. Clear the
-- stamp so the nightly pregenerate picks the account up again instead of
-- waiting out the staleness window with an empty card.
UPDATE "users"
   SET "insights_cached_at" = NULL
 WHERE "insights_cached_text_encrypted" IS NULL
   AND "insights_cached_at" IS NOT NULL;
