-- Questionnaires in every app language: an administration records which text
-- its answers were given in. "validated" is a published validated version,
-- "unvalidated_translation" a translation written for the app (shown with a
-- note), "original_en" the English original chosen by a reader of another
-- language.
--
-- Nullable, no default, no backfill: earlier rows did not record it, and
-- which text they showed depended on releases since replaced, so null reads
-- as "not recorded" rather than as a guess.
--
-- Reversibility: dropping the column loses only that marker; the scores and
-- the encrypted answers do not depend on it.

ALTER TABLE "mental_health_assessments" ADD COLUMN IF NOT EXISTS "wording" TEXT;
