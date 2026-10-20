-- Single-use OAuth callbacks.
--
-- A browser can deliver an OAuth callback twice with the same code and state,
-- a few hundred milliseconds apart. The connect flows that sign their state
-- (Oura, Polar, Strava) kept no record of it, so both requests exchanged the
-- code; the second was refused, and Oura answers a reused code by revoking the
-- token the first exchange had just issued. A row here is the claim on one
-- callback: the first request inserts it before the exchange, a duplicate
-- finds it taken and is sent where the first one went. No user id, token or
-- code is stored; the key is a hash of the provider and the state.
--
-- Reversibility:
--   DROP TABLE IF EXISTS "oauth_callback_claims";

-- CreateTable
CREATE TABLE "oauth_callback_claims" (
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "settled_at" TIMESTAMP(3),
    "location" TEXT,

    CONSTRAINT "oauth_callback_claims_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "oauth_callback_claims_expires_at_idx" ON "oauth_callback_claims"("expires_at");
