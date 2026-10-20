-- Retire `measurements_user_id_type_measured_at_idx`.
--
-- `(user_id, type, measured_at)` is the leading part of the unique key
-- `(user_id, type, measured_at, source, sleep_stage)`, and live reads have
-- `measurements_live_covering_idx` besides. Every query shape that used the
-- shorter index plans the same way on the unique key, at a cost within a few
-- percent (`tests/integration/index-hygiene.test.ts` compares the plans on a
-- seeded table). The index cost every write to the densest table in the
-- schema and, on a bloated instance, more space than the table itself.
--
-- This runs at boot, so it must not wait on the table. A plain `DROP INDEX`
-- needs ACCESS EXCLUSIVE on `measurements`, held for the instant the catalog
-- changes; `DROP INDEX CONCURRENTLY` blocks nobody but waits, without bound,
-- for every transaction on the table (a pg_dump, a backfill), long enough for
-- the container to be replaced mid-migration and the next boot to stop at
-- P3009. So the drop is tried once with a two-second lock wait (the most the
-- table's other statements can queue behind the request), and a timeout is
-- swallowed: the migration then succeeds with the index still there, and
-- the nightly measurement maintenance drops it with
-- `DROP INDEX CONCURRENTLY IF EXISTS` (`RETIRED_MEASUREMENT_INDEXES` in
-- `src/lib/jobs/measurement-maintenance.ts`). A fresh database and Prisma's
-- shadow database take the lock at once, so the migration history ends
-- without the index, as the schema does. The pattern, for the next large
-- index: docs/ops/measurement-maintenance.md, "Retired indexes".
--
-- @retry-on-lock-timeout

DO $migration$
BEGIN
    PERFORM set_config('lock_timeout', '2s', true);
    DROP INDEX IF EXISTS "measurements_user_id_type_measured_at_idx";
EXCEPTION WHEN lock_not_available THEN
    RAISE NOTICE 'measurements_user_id_type_measured_at_idx is in use; the nightly measurement maintenance drops it';
END
$migration$;
