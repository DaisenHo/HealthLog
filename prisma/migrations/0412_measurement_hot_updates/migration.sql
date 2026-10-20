-- Let an update of `measurements` that changes nothing stay a HOT update.
--
-- Every write path that re-reads a provider window (Withings, Fitbit, Oura,
-- the Apple Health `stats:` overwrites, the reconcile paths) updates rows
-- whose values did not change, and each such update moved `updated_at`
-- (Prisma's `@updatedAt`) and `sync_version`. `updated_at` sits in the
-- sync-feed index `measurements_user_id_updated_at_id_idx`, so not one of
-- those updates could be heap-only: every one wrote a new row version on
-- another page and an entry in every index, the table grew several times
-- its live size, and every unchanged row went back down the `/api/sync/changes`
-- feed to the phone.
--
-- 1. A row trigger keeps `updated_at` and `sync_version` as they were when
--    the update changes no other column. Such an update then touches no
--    indexed column, so Postgres can keep it on the page (HOT), and the
--    sync feed stays silent because nothing changed. An update that does
--    change something still moves both stamps, exactly as before.
-- 2. `fillfactor = 85` leaves room on each page for those in-page versions;
--    it applies to pages written from now on (a `VACUUM FULL` rewrites the
--    rest).
-- 3. Autovacuum starts at 5 % dead rows instead of 20 %, so a large table
--    does not wait for a fifth of itself to be dead before it is cleaned.
--
-- `to_jsonb(row)` compares every column, so a column added later is covered
-- without touching this function.
--
-- Lock wait. `CREATE TRIGGER` takes SHARE ROW EXCLUSIVE on the table and the
-- `ALTER TABLE ... SET` SHARE UPDATE EXCLUSIVE; both wait for an autovacuum
-- that is preventing wraparound, which does not step aside, and while they
-- wait every write to `measurements` queues behind them, including the ones
-- the running release still serves during a deploy. The wait is bounded at
-- ten seconds; past that the attempt fails with SQLSTATE 55P03 and the queued
-- writes go on.
--
-- `migrate deploy` does not run a migration file inside one transaction: each
-- statement commits on its own, so a top-level `SET LOCAL` does nothing and a
-- file that fails half-way stays half-applied. The two statements that take a
-- lock therefore run inside one `DO` block, which is a single statement and
-- so commits or rolls back whole, and the timeout is set inside it with
-- `set_config(..., true)`, scoped to that statement. The function before it
-- is `CREATE OR REPLACE` and harmless to run again. A lock timeout leaves the
-- file safe to apply once more, which is what the marker below declares:
-- `scripts/migrate-deploy.mjs` marks the attempt rolled back and retries it
-- with a backoff (docs/ops/deploy.md, "A migration that timed out on a lock").
--
-- @retry-on-lock-timeout

CREATE OR REPLACE FUNCTION "measurements_keep_stamps_on_noop"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF (to_jsonb(NEW) - 'updated_at' - 'sync_version')
       = (to_jsonb(OLD) - 'updated_at' - 'sync_version') THEN
        NEW."updated_at" := OLD."updated_at";
        NEW."sync_version" := OLD."sync_version";
    END IF;
    RETURN NEW;
END;
$$;

DO $migration$
BEGIN
    PERFORM set_config('lock_timeout', '10s', true);

    CREATE TRIGGER "measurements_noop_update_keeps_stamps"
        BEFORE UPDATE ON "measurements"
        FOR EACH ROW
        EXECUTE FUNCTION "measurements_keep_stamps_on_noop"();

    ALTER TABLE "measurements" SET (
        fillfactor = 85,
        autovacuum_vacuum_scale_factor = 0.05,
        autovacuum_analyze_scale_factor = 0.05
    );
END
$migration$;
