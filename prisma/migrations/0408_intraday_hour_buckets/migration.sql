-- Hour buckets for summed intraday types (ios #77).
--
-- A day of steps, active energy, distance or flights can be built from the
-- hourly `stats:<HK>:<YYYY-MM-DD>T<HH>` rows the app posts instead of the fold
-- of single samples. The hour increments live beside the running totals;
-- `basis` says which source built the profile.

-- AlterTable
ALTER TABLE "intraday_cumulative_profiles"
    ADD COLUMN "hourly_increments" DOUBLE PRECISION[],
    ADD COLUMN "basis" TEXT NOT NULL DEFAULT 'PER_SAMPLE',
    ADD COLUMN "bucket_count" INTEGER;

ALTER TABLE "intraday_cumulative_profiles"
    ADD CONSTRAINT "intraday_cumulative_profiles_basis_check"
    CHECK ("basis" IN ('PER_SAMPLE', 'HOUR_BUCKETS'));
