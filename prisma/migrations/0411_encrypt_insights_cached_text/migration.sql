-- The cached AI insights payload moves to AES-256-GCM at rest.
--
-- `users.insights_cached_text` held the model's last full reading of the
-- account in the clear: the daily briefing, the per-domain status text and the
-- recommendations. It was the last readable column of that kind on the user
-- row. From this release every write goes to `insights_cached_text_encrypted`
-- (binary layout, purpose-bound label) and leaves the readable column NULL.
--
-- SQL cannot encrypt, so this migration only adds the ciphertext column and
-- the discovery index. The boot-time `free-text-encryption-backfill` job seals
-- the existing rows one at a time and nulls the readable value in the same
-- transaction; it is fail-closed, so a missing or malformed key leaves the row
-- untouched and the job retries. Readers fall back to the readable column until
-- the backfill has reached a row. The readable column is dropped in a later
-- release, once the backfill reports nothing left on every instance.
--
-- Additive only: no table rewrite, no data change.

ALTER TABLE "users" ADD COLUMN "insights_cached_text_encrypted" BYTEA;

-- Partial index on exactly the backfill's discovery predicate, so the boot
-- scan is index-only and shrinks to nothing as the backfill converges (the
-- 0357 precedent).
CREATE INDEX IF NOT EXISTS "users_insights_cached_text_backfill_idx"
  ON "users" ("id")
  WHERE "insights_cached_text" IS NOT NULL;
