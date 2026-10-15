-- Dawarich movement context.
--
-- Per-account sealed connection (URL, API key, preferences) and one row per
-- local day with daily values only: distances in metres, places visited,
-- minutes away from home, and the sealed country code of the day. No
-- coordinate, place name or visit is stored anywhere.

-- AlterTable
ALTER TABLE "users"
    ADD COLUMN "dawarich_url_encrypted" TEXT,
    ADD COLUMN "dawarich_api_key_encrypted" TEXT,
    ADD COLUMN "dawarich_prefs_encrypted" BYTEA,
    ADD COLUMN "dawarich_allow_private_host" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "dawarich_days" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "total_distance_m" INTEGER,
    "driving_distance_m" INTEGER,
    "train_distance_m" INTEGER,
    "places_visited" INTEGER,
    "away_from_home_minutes" INTEGER,
    "country_code_encrypted" BYTEA,
    "is_travel_day" BOOLEAN,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dawarich_days_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dawarich_days_user_id_date_key" ON "dawarich_days"("user_id", "date");

-- AddForeignKey
ALTER TABLE "dawarich_days" ADD CONSTRAINT "dawarich_days_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
