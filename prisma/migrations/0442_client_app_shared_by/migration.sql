-- Which provider apps on a record were copied from a guardian, and from whom.
--
-- A guardian connecting a provider for a managed profile lends the profile
-- their own provider app (client id and secret, still sealed). The marker lets
-- the copy be removed when the provider is disconnected or the guardian's
-- MANAGE grant ends, instead of the secret staying on the profile for good.
--
-- Nullable and unset for every existing row. A copy made before this column
-- existed carries no marker and is left as it is: there is no reliable way to
-- tell it from an app the record holds of its own.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "client_app_shared_by" JSONB;
