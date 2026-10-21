-- The Oura account id behind a connection.
--
-- Read from `personal_info` at connect, so a connect that would attach an
-- Oura account another record already holds can be refused. Nullable and
-- unset for every existing row: a current connection is never asked to
-- reconnect, the id fills in at its next connect.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oura_user_id" TEXT;
CREATE INDEX IF NOT EXISTS "users_oura_user_id_idx" ON "users" ("oura_user_id");
