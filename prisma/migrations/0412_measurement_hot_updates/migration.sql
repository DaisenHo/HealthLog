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

CREATE TRIGGER "measurements_noop_update_keeps_stamps"
    BEFORE UPDATE ON "measurements"
    FOR EACH ROW
    EXECUTE FUNCTION "measurements_keep_stamps_on_noop"();

ALTER TABLE "measurements" SET (
    fillfactor = 85,
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_scale_factor = 0.05
);
