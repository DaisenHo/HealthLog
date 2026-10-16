-- Drop the plaintext location columns (#615 follow-up).
--
-- Since v1.42 every location is sealed (`users.home_location_encrypted`,
-- `environment_contexts.location_encrypted`,
-- `environment_travel_locations.location_encrypted`), and the free-text
-- encryption backfill moved the plaintext into the sealed copy and cleared
-- it. This migration removes the plaintext columns and the partial indexes
-- from 0382 that served the backfill.
--
-- It refuses to run while any row still holds a plaintext location: such a
-- row has not been sealed yet, and dropping the column would lose it. Start
-- the previous release, let the backfill finish (the three counts below must
-- all be 0), then upgrade again. The operator steps, including clearing the
-- failed attempt, are in docs/ops/migration-0409-plaintext-location.md.
DO $$
DECLARE
    home_rows   BIGINT;
    travel_rows BIGINT;
    day_rows    BIGINT;
BEGIN
    SELECT count(*) INTO home_rows FROM "users" WHERE "home_lat" IS NOT NULL;
    SELECT count(*) INTO travel_rows FROM "environment_travel_locations" WHERE "lat" IS NOT NULL;
    SELECT count(*) INTO day_rows FROM "environment_contexts" WHERE "lat" IS NOT NULL;
    IF home_rows > 0 OR travel_rows > 0 OR day_rows > 0 THEN
        RAISE EXCEPTION 'HealthLog migration 0409 stopped: % home location(s), % location period(s) and % daily location(s) are still stored in plaintext. Run the previous release until its free-text encryption backfill reports zero remaining rows, then upgrade again. Nothing was changed. Recovery steps: docs/ops/migration-0409-plaintext-location.md', home_rows, travel_rows, day_rows;
    END IF;
END
$$;

-- DropIndex
DROP INDEX IF EXISTS "users_home_location_plain_idx";
DROP INDEX IF EXISTS "environment_travel_locations_plain_location_idx";
DROP INDEX IF EXISTS "environment_contexts_plain_location_idx";

-- AlterTable
ALTER TABLE "users"
    DROP COLUMN "home_lat",
    DROP COLUMN "home_lon",
    DROP COLUMN "home_label";

-- AlterTable
ALTER TABLE "environment_contexts"
    DROP COLUMN "lat",
    DROP COLUMN "lon",
    DROP COLUMN "location_label";

-- AlterTable
ALTER TABLE "environment_travel_locations"
    DROP COLUMN "lat",
    DROP COLUMN "lon",
    DROP COLUMN "label";
