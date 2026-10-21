-- Extend `measurement_type` with six Apple Health signals that sat in the
-- deferred list: the exercise and stand rings, mindful minutes, the State of
-- Mind valence, and AFib burden.
--
--   EXERCISE_MINUTES       <- HKQuantityTypeIdentifierAppleExerciseTime
--   STAND_MINUTES          <- HKQuantityTypeIdentifierAppleStandTime
--   STAND_HOURS            <- HKCategoryTypeIdentifierAppleStandHour
--   MINDFUL_MINUTES        <- HKCategoryTypeIdentifierMindfulSession
--   STATE_OF_MIND_VALENCE  <- HKDataTypeIdentifierStateOfMind (valence)
--   AFIB_BURDEN            <- HKQuantityTypeIdentifierAtrialFibrillationBurden
--
-- Purely additive: no existing row carries any of these values. IF NOT
-- EXISTS keeps a replay on a partially applied database harmless. Enum
-- values cannot be dropped in PostgreSQL, so there is no down path.

ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'EXERCISE_MINUTES';
ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'STAND_MINUTES';
ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'STAND_HOURS';
ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'MINDFUL_MINUTES';
ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'STATE_OF_MIND_VALENCE';
ALTER TYPE "measurement_type" ADD VALUE IF NOT EXISTS 'AFIB_BURDEN';
