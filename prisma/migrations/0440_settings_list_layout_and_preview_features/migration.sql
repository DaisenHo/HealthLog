-- Two per-user preference columns for Settings.
--
-- module_list_layout_json: the card/list view, manual order and labs sort for
-- the labs, illness and checkups lists. These lived in the browser until now,
-- so they did not follow a person to another device. The client copies a value
-- it still holds in the browser up once, when the server has none for that list.
--
-- preview_features_json: the per-user opt-in to preview features, one boolean
-- per flag, all off by default.
--
-- Nullable, no default, no backfill: null reads as the defaults.
--
-- Reversibility: dropping the columns returns every list to its default
-- presentation and switches every preview feature off.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "module_list_layout_json" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preview_features_json" JSONB;
