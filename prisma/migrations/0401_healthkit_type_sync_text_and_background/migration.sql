-- Per-type HealthKit arrival ledger: room for non-measurement types, and the
-- last background arrival per type.
--
-- `type` moves from the `measurement_type` enum to text so the ledger can
-- also record Apple Health medication doses (`MEDICATION_DOSE`), which are
-- not a measurement type. Every stored enum value converts to its own label
-- through the enum's text output, so no row changes meaning. The table holds
-- at most one row per (user, delivered type), a few dozen per account; the
-- rewrite and the primary-key rebuild it implies are cheap at any size this
-- table reaches, and the key keeps its name and columns.
ALTER TABLE "healthkit_type_syncs"
    ALTER COLUMN "type" SET DATA TYPE TEXT USING "type"::text;

-- When a batch with `syncTrigger = background` last carried the type. A
-- later foreground or manual arrival leaves it standing.
ALTER TABLE "healthkit_type_syncs" ADD COLUMN "last_background_at" TIMESTAMP(3);

-- A row whose latest arrival was already a background one says exactly that,
-- so it starts with that date rather than null. Rows whose latest arrival
-- came another way cannot know an earlier background date and stay null.
UPDATE "healthkit_type_syncs"
SET "last_background_at" = "last_received_at"
WHERE "last_trigger" = 'background';
