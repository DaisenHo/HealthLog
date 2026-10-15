-- AI usage in three levels (#1217).
--
-- An account picks frugal, standard or full; the operator sets the highest
-- level an account may pick and the level an account without its own choice
-- runs at. `ai_sync_regen_gap_hours` is the minimum gap between status-card
-- regenerations after a sync at `standard` (NULL = env or 6 h). Both
-- instance defaults are STANDARD; an account's stored NULL follows the
-- instance default.

-- CreateEnum
CREATE TYPE "ai_usage_level" AS ENUM ('FRUGAL', 'STANDARD', 'FULL');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "ai_usage_level" "ai_usage_level";

-- AlterTable
ALTER TABLE "app_settings"
    ADD COLUMN "ai_usage_max_level" "ai_usage_level" NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN "ai_usage_default_level" "ai_usage_level" NOT NULL DEFAULT 'STANDARD',
    ADD COLUMN "ai_sync_regen_gap_hours" INTEGER;

ALTER TABLE "app_settings"
    ADD CONSTRAINT "app_settings_ai_sync_regen_gap_hours_check"
    CHECK ("ai_sync_regen_gap_hours" IS NULL OR "ai_sync_regen_gap_hours" BETWEEN 1 AND 48);
