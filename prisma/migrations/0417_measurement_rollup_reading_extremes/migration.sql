-- The lowest and highest reading value per rollup bucket.
--
-- The full-history extremes the insight features carry (`allTimeMin`,
-- `allTimeMax`, `allTimeAvg` for weight, blood pressure and pulse) were read
-- from the raw `measurements` rows on every call: two passes over every
-- reading of those types the account ever recorded, the largest read on the
-- database. The DAY rollups already hold everything that fold needs except
-- the extremes of the readings themselves: `min_value` / `max_value` widen to
-- a row's own `value_min` / `value_max`, the intra-hour range an hourly
-- heart-rate statistic carries, so they are not the same figure.
--
-- Two nullable columns. Existing rows read NULL until the boot re-fold
-- (`rollup-full-backfill`, discovered by the NULL arm beside `sum_xy`)
-- refills them; new writes fill them from the same aggregate as every other
-- column. A reader treats a type with a NULL in its window as uncovered and
-- reads the raw rows, as before.
--
-- Reversibility:
--   ALTER TABLE "measurement_rollups" DROP COLUMN IF EXISTS "reading_min_value";
--   ALTER TABLE "measurement_rollups" DROP COLUMN IF EXISTS "reading_max_value";

ALTER TABLE "measurement_rollups" ADD COLUMN IF NOT EXISTS "reading_min_value" DOUBLE PRECISION;

ALTER TABLE "measurement_rollups" ADD COLUMN IF NOT EXISTS "reading_max_value" DOUBLE PRECISION;
