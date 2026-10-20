-- Index hygiene: a leading index for every foreign key that cascades, and
-- no index that is a prefix of another.
--
-- 1. Twenty-one foreign keys with ON DELETE CASCADE or SET NULL had no index
--    leading with their column. Deleting the parent row (a medication, a
--    schedule, a practitioner, an account) then scans the whole child table
--    once per deleted parent: `medication_intake_events.medication_id` is the
--    one that hurts, scanned in full for every medication an account delete
--    removes. Each gets a plain btree on the column.
--
-- 2. Seventeen indexes repeated the leading columns of another index on the
--    same table, in the same order and direction, mostly a `(user_id)` index
--    beside a `(user_id, …)` unique key. The longer index answers every
--    lookup the shorter one did, so the shorter one only cost writes and
--    space. They go. `measurements` has its own migration (0416), because a
--    lock on that table weighs differently.
--
-- `tests/integration/index-hygiene.test.ts` holds the schema to both rules
-- from the catalog.
--
-- Lock wait. `CREATE INDEX` takes SHARE on its table (reads go on, writes
-- wait while it builds; every table here is small, so the build is quick)
-- and `DROP INDEX` takes ACCESS EXCLUSIVE for the instant the catalog
-- changes. `CREATE INDEX CONCURRENTLY` cannot share a migration file with
-- any other statement (0416), so the whole set runs in one `DO` block: one
-- statement that commits or rolls back whole, with the lock wait bounded at
-- five seconds so a long reader cannot queue the tables' writes behind the
-- migration. Every statement is `IF [NOT] EXISTS`, so a lock timeout leaves
-- the file safe to apply again, which the marker declares
-- (docs/ops/deploy.md, "A migration that timed out on a lock").
--
-- @retry-on-lock-timeout

DO $migration$
BEGIN
    PERFORM set_config('lock_timeout', '5s', true);

    -- 1. Foreign keys without a leading index.
    CREATE INDEX IF NOT EXISTS "passkeys_user_id_idx"
        ON "passkeys" ("user_id");
    CREATE INDEX IF NOT EXISTS "medication_schedules_medication_id_idx"
        ON "medication_schedules" ("medication_id");
    CREATE INDEX IF NOT EXISTS "medication_intake_events_medication_id_idx"
        ON "medication_intake_events" ("medication_id");
    CREATE INDEX IF NOT EXISTS "telegram_reminder_messages_schedule_id_idx"
        ON "telegram_reminder_messages" ("schedule_id");
    CREATE INDEX IF NOT EXISTS "medication_inventory_items_medication_id_idx"
        ON "medication_inventory_items" ("medication_id");
    CREATE INDEX IF NOT EXISTS "medication_side_effects_medication_id_idx"
        ON "medication_side_effects" ("medication_id");
    CREATE INDEX IF NOT EXISTS "withings_oauth_states_user_id_idx"
        ON "withings_oauth_states" ("user_id");
    CREATE INDEX IF NOT EXISTS "whoop_oauth_states_user_id_idx"
        ON "whoop_oauth_states" ("user_id");
    CREATE INDEX IF NOT EXISTS "fitbit_oauth_states_user_id_idx"
        ON "fitbit_oauth_states" ("user_id");
    CREATE INDEX IF NOT EXISTS "google_health_oauth_states_user_id_idx"
        ON "google_health_oauth_states" ("user_id");
    CREATE INDEX IF NOT EXISTS "whoop_connect_tickets_user_id_idx"
        ON "whoop_connect_tickets" ("user_id");
    CREATE INDEX IF NOT EXISTS "cycle_day_logs_cycle_id_idx"
        ON "cycle_day_logs" ("cycle_id");
    CREATE INDEX IF NOT EXISTS "invite_tokens_created_by_idx"
        ON "invite_tokens" ("created_by");
    CREATE INDEX IF NOT EXISTS "invite_tokens_used_by_idx"
        ON "invite_tokens" ("used_by");
    CREATE INDEX IF NOT EXISTS "invite_redemptions_user_id_idx"
        ON "invite_redemptions" ("user_id");
    CREATE INDEX IF NOT EXISTS "custom_metric_entries_custom_metric_id_idx"
        ON "custom_metric_entries" ("custom_metric_id");
    CREATE INDEX IF NOT EXISTS "encounters_reminder_id_idx"
        ON "encounters" ("reminder_id");
    CREATE INDEX IF NOT EXISTS "vaccination_records_encounter_id_idx"
        ON "vaccination_records" ("encounter_id");
    CREATE INDEX IF NOT EXISTS "vaccination_records_practitioner_id_idx"
        ON "vaccination_records" ("practitioner_id");
    CREATE INDEX IF NOT EXISTS "vaccination_records_reminder_id_idx"
        ON "vaccination_records" ("reminder_id");
    CREATE INDEX IF NOT EXISTS "managed_profile_handovers_created_by_id_idx"
        ON "managed_profile_handovers" ("created_by_id");

    -- 2. Indexes that are a prefix of another index on the same table.
    DROP INDEX IF EXISTS "biomarkers_user_id_idx";
    DROP INDEX IF EXISTS "clinician_share_link_documents_share_link_id_idx";
    DROP INDEX IF EXISTS "coach_usage_user_id_date_key_idx";
    DROP INDEX IF EXISTS "custom_metrics_user_id_idx";
    DROP INDEX IF EXISTS "cycle_day_logs_user_id_date_idx";
    DROP INDEX IF EXISTS "data_backups_user_id_idx";
    DROP INDEX IF EXISTS "environment_contexts_user_id_date_idx";
    DROP INDEX IF EXISTS "illness_day_logs_episode_id_idx";
    DROP INDEX IF EXISTS "integration_statuses_user_id_idx";
    DROP INDEX IF EXISTS "medications_user_id_idx";
    DROP INDEX IF EXISTS "menstrual_cycles_user_id_start_date_idx";
    DROP INDEX IF EXISTS "mood_entries_user_id_date_idx";
    DROP INDEX IF EXISTS "notification_channels_user_id_idx";
    DROP INDEX IF EXISTS "push_subscriptions_user_id_idx";
    DROP INDEX IF EXISTS "refresh_tokens_user_id_idx";
    DROP INDEX IF EXISTS "user_achievements_user_id_idx";
    DROP INDEX IF EXISTS "user_known_devices_user_id_idx";
END
$migration$;
