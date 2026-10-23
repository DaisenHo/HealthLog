-- #1259: a batch that carries a type with duplicates only no longer counts as
-- an arrival of that type. It stamps this column instead, so the card can
-- still say the phone re-sent the type while `last_received_at` keeps the
-- last batch that brought something new.
--
-- Nullable, no default, no backfill: null reads as "no duplicates-only batch
-- recorded", which is true for every row until the next one.
--
-- Reversibility: dropping the column loses only that stamp; nothing else
-- reads it.

ALTER TABLE "healthkit_type_syncs" ADD COLUMN IF NOT EXISTS "last_seen_duplicate_at" TIMESTAMP(3);
