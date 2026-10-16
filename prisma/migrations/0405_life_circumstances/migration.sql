-- Life circumstances (#614).
--
-- Six new structured fact kinds (sealed JSON values, `schema: 1`), four new
-- AI sections that are never in the column default, AUDIT-C as an assessment
-- instrument, and the per-section "still true" confirmations. The new enum
-- values are added only; nothing in this migration uses them, so the
-- in-transaction ADD VALUE restriction does not apply.

-- AlterEnum
ALTER TYPE "health_profile_fact_kind" ADD VALUE 'TOBACCO_DETAIL';
ALTER TYPE "health_profile_fact_kind" ADD VALUE 'ACTIVITY_HABIT';
ALTER TYPE "health_profile_fact_kind" ADD VALUE 'WORK_CONTEXT';
ALTER TYPE "health_profile_fact_kind" ADD VALUE 'FREE_WEEKDAYS';
ALTER TYPE "health_profile_fact_kind" ADD VALUE 'HABITS';
ALTER TYPE "health_profile_fact_kind" ADD VALUE 'HEALTH_GOALS';

-- AlterEnum
ALTER TYPE "health_profile_ai_section" ADD VALUE 'ACTIVITY';
ALTER TYPE "health_profile_ai_section" ADD VALUE 'WORK';
ALTER TYPE "health_profile_ai_section" ADD VALUE 'HABITS';
ALTER TYPE "health_profile_ai_section" ADD VALUE 'GOALS';

-- AlterEnum
ALTER TYPE "assessment_instrument" ADD VALUE 'AUDIT_C';

-- AlterTable
ALTER TABLE "user_health_profiles" ADD COLUMN "life_confirmed_json" JSONB;
