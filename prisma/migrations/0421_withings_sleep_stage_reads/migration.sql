-- Per-night stage-read bookkeeping for the Withings sleep sync.
--
-- The sync reads each night's stage timeline on its own. A night whose read
-- failed was lost with every night read before it, and a night that never
-- carries stages (a tracker without them) was read again on every run for as
-- long as it stayed in the 30-day window. The column records, per night, how
-- many reads came back without a stage and whether the last one failed, so a
-- failed night is read first next time and an unstaged one is given up after
-- a few tries.
--
-- Nullable, no default, no backfill: a connection without it reads every
-- night as before and starts keeping the record on its next sync.
--
-- Reversibility: dropping the column loses only the record; the sync then
-- reads every night as before.

ALTER TABLE "withings_connections" ADD COLUMN "sleep_stage_reads" JSONB;
