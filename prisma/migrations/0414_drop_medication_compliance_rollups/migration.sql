-- Drop `medication_compliance_rollups`.
--
-- The per-(user, medication, day) coverage ledger lost its last reader when
-- the dashboard tile and the compliance views moved to the schedule-anchored
-- computation; every dose write still upserted a row into it, a boot backfill
-- refolded it, and it travelled through the data wipe for nothing. The write
-- hook now refreshes only what still derives from a dose day (the supplement
-- nutrients), and the boot retires the backfill queue.
--
-- Nothing is lost: the table held counts derived from
-- `medication_intake_events`, which stay.
--
-- Lock wait. Dropping the table removes its two foreign keys, and removing a
-- foreign key's triggers takes ACCESS EXCLUSIVE on the referenced tables,
-- `users` and `medications`, for the instant the catalog changes. Waiting for
-- that lock behind a long reader would queue every login and every
-- medication read behind the migration, so the wait is bounded at five
-- seconds inside one `DO` block (one statement, so it commits or rolls back
-- whole; `migrate deploy` runs a file statement by statement). A lock
-- timeout changes nothing and the file is safe to apply again, which the
-- marker declares (docs/ops/deploy.md, "A migration that timed out on a
-- lock").
--
-- @retry-on-lock-timeout

DO $migration$
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);

    DROP TABLE IF EXISTS "medication_compliance_rollups";
END
$migration$;
