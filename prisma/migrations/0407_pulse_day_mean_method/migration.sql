-- Pulse day-mean method (#1107 follow-up).
--
-- The method every pulse day-mean reader uses, switched only by the admin
-- apply step after a dry run. `hour_mean_v1` is the behaviour up to v1.42.

-- AlterTable
ALTER TABLE "app_settings"
    ADD COLUMN "pulse_day_mean_method" TEXT NOT NULL DEFAULT 'hour_mean_v1',
    ADD COLUMN "pulse_day_mean_applied_at" TIMESTAMP(3),
    ADD COLUMN "pulse_day_mean_dry_run_json" JSONB;

ALTER TABLE "app_settings"
    ADD CONSTRAINT "app_settings_pulse_day_mean_method_check"
    CHECK ("pulse_day_mean_method" IN ('hour_mean_v1', 'weighted_hour_mean_v2'));
