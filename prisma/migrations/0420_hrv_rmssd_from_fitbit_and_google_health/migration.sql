-- Fitbit and Google Health HRV is RMSSD; file it as such.
--
-- Both providers report a nightly RMSSD (`dailyRmssd`; Google documents its
-- daily average as RMSSD too), but their mappers wrote it as
-- `HEART_RATE_VARIABILITY`, the SDNN series. The `hrv` ladder ranks Fitbit and
-- Google Health above Apple Health, so an account with both had a series that
-- switched estimator from day to day, and every baseline, trend and
-- correlation over it measured the switch. The mappers now write `HRV_RMSSD`;
-- this moves the rows they wrote before.
--
-- Every `HEART_RATE_VARIABILITY` row under source FITBIT or GOOGLE_HEALTH came
-- from that one daily-HRV mapper per provider (their externalIds end in
-- `:hrv`), so source and type identify them. Tombstones move too, so the sync
-- feed and a restore see the same type. A row whose RMSSD twin already exists
-- under the `(user, type, source, externalId)` key stays where it is.
--
-- Derived state that would otherwise keep the old filing:
--   - the FITBIT / GOOGLE_HEALTH `HEART_RATE_VARIABILITY` rollup buckets are
--     dropped (no rows remain behind them);
--   - every `HRV_RMSSD` rollup bucket of an account whose rows moved is
--     dropped, so the per-type coverage probe reads that series live and the
--     boot-time rollup discovery (`enqueueBootTimeRollupBackfill`, which flags
--     any (user, type, day) with no DAY bucket) folds the account again on the
--     next worker start. Dropping only the moved days would not do: a day that
--     another source already covers would keep its bucket and never be
--     flagged, and the moved rows would be missing from it;
--   - personal records filed under `HEART_RATE_VARIABILITY` from those sources
--     are deleted. They ranked an RMSSD value as an SDNN best; `HRV_RMSSD` keeps
--     no records, and the detector re-derives the SDNN ones from what remains.
--
-- One `DO` block, so the move and its cleanup commit or roll back together
-- (`migrate deploy` commits each top-level statement on its own). Running it
-- again finds nothing to move and drops nothing a fold has not rebuilt.
--
-- Reversibility: the moved rows carry source FITBIT / GOOGLE_HEALTH and type
-- `HRV_RMSSD`, which nothing else writes for those sources; setting the type
-- back and dropping their rollups reverses it.

DO $migration$
BEGIN
  WITH moved AS (
    UPDATE "measurements" m
    SET "type" = 'HRV_RMSSD',
        "updated_at" = CURRENT_TIMESTAMP,
        "sync_version" = m."sync_version" + 1
    WHERE m."type" = 'HEART_RATE_VARIABILITY'
      AND m."source" IN ('FITBIT', 'GOOGLE_HEALTH')
      AND NOT EXISTS (
        SELECT 1
        FROM "measurements" twin
        WHERE twin."user_id" = m."user_id"
          AND twin."type" = 'HRV_RMSSD'
          AND twin."source" = m."source"
          AND twin."external_id" = m."external_id"
      )
    RETURNING m."user_id"
  )
  DELETE FROM "measurement_rollups" r
  WHERE r."type" = 'HRV_RMSSD'
    AND r."user_id" IN (SELECT DISTINCT "user_id" FROM moved);

  DELETE FROM "measurement_rollups"
  WHERE "type" = 'HEART_RATE_VARIABILITY'
    AND "source" IN ('FITBIT', 'GOOGLE_HEALTH');

  DELETE FROM "personal_records"
  WHERE "metric_type" = 'HEART_RATE_VARIABILITY'
    AND "source" IN ('FITBIT', 'GOOGLE_HEALTH');
END
$migration$;
