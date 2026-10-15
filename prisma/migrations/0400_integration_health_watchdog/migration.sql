-- v1.42.4 — one health state per connection, and a watchdog behind it.
--
-- `integration_statuses.recent_calls` keeps the last ten sync attempts per
-- connection as `{ endpoint, status, at, errorCode }`: the leg name, the
-- outcome, the instant and a short error code. No message, token or value is
-- stored in it; it is the source of the redacted diagnostics a user can copy
-- into a bug report.
--
-- `integration_watches` holds what the integration watchdog observed per
-- connection: whether a source that normally delivers has gone silent, and
-- the one operator incident open for it, so an alert is sent once per
-- incident and a recovery note once when it closes.
--
-- Additive only: one nullable column, one new table, no rewrite.
ALTER TABLE "integration_statuses" ADD COLUMN IF NOT EXISTS "recent_calls" JSONB;

CREATE TABLE IF NOT EXISTS "integration_watches" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "integration" TEXT NOT NULL,
    "silent_since" TIMESTAMP(3),
    "incident_reason" TEXT,
    "incident_opened_at" TIMESTAMP(3),
    "alerted_at" TIMESTAMP(3),
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_watches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "integration_watches_user_id_integration_key"
  ON "integration_watches"("user_id", "integration");

DO $$ BEGIN
  ALTER TABLE "integration_watches"
    ADD CONSTRAINT "integration_watches_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
