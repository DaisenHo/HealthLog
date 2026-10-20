-- The geo backfill notes when it last tried a row, and finds its candidates
-- through an index that holds only them.
--
-- The hourly backfill (`src/lib/jobs/geo-backfill.ts`) re-resolves audit rows
-- whose location or carrier is missing. An address no database will ever
-- place (a private range that reached the log through a proxy) stays missing,
-- so the same few rows were looked up again on every pass, and finding them
-- meant walking thirty days of `audit_logs` through `created_at`, filtering
-- every row that had long been resolved.
--
-- `geo_attempted_at` records the try; the backfill skips a row it tried less
-- than `GEO_BACKFILL_RETRY_DAYS` ago. NULL for every existing row: each is
-- tried once more, then waits like any other.
--
-- `audit_logs_geo_backfill_idx` is partial on the rows still missing
-- something, so it holds the backlog and nothing else, and shrinks as rows
-- resolve. Prisma cannot express the predicate, so the index lives here only
-- (noted at the model in `schema.prisma`). A plain build: it takes SHARE on
-- `audit_logs` while it reads the table once, which `migrate deploy` does at
-- boot before the app serves.
--
-- Reversibility:
--   DROP INDEX IF EXISTS "audit_logs_geo_backfill_idx";
--   ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "geo_attempted_at";

ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "geo_attempted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "audit_logs_geo_backfill_idx"
  ON "audit_logs" ("created_at")
  WHERE "ip_address" IS NOT NULL AND ("location" IS NULL OR "carrier" IS NULL);
