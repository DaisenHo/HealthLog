-- Biomarker aliases and the merge ledger (D1223).
--
-- An alias is another spelling of a marker on one account; the fold of the
-- name is unique per account, so one spelling resolves to one marker. A merge
-- moves the source markers' readings onto the target and deletes the sources;
-- `biomarker_merges` keeps one row per source so a stale id can answer with
-- the marker it went into.

-- CreateTable
CREATE TABLE "biomarker_aliases" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "biomarker_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "name_folded" VARCHAR(120) NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biomarker_aliases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "biomarker_aliases_source_check" CHECK ("source" IN ('MERGE', 'IMPORT_CHOICE', 'MANUAL'))
);

-- CreateTable
CREATE TABLE "biomarker_merges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_biomarker_id" TEXT NOT NULL,
    "source_biomarker_id" TEXT NOT NULL,
    "source_name" VARCHAR(120) NOT NULL,
    "reading_count" INTEGER NOT NULL,
    "merged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "biomarker_merges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "biomarker_aliases_biomarker_id_idx" ON "biomarker_aliases"("biomarker_id");

-- CreateIndex
CREATE UNIQUE INDEX "biomarker_aliases_user_id_name_folded_key" ON "biomarker_aliases"("user_id", "name_folded");

-- CreateIndex
CREATE INDEX "biomarker_merges_user_id_source_biomarker_id_idx" ON "biomarker_merges"("user_id", "source_biomarker_id");

-- CreateIndex
CREATE INDEX "biomarker_merges_target_biomarker_id_idx" ON "biomarker_merges"("target_biomarker_id");

-- AddForeignKey
ALTER TABLE "biomarker_aliases" ADD CONSTRAINT "biomarker_aliases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biomarker_aliases" ADD CONSTRAINT "biomarker_aliases_biomarker_id_fkey" FOREIGN KEY ("biomarker_id") REFERENCES "biomarkers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biomarker_merges" ADD CONSTRAINT "biomarker_merges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biomarker_merges" ADD CONSTRAINT "biomarker_merges_target_biomarker_id_fkey" FOREIGN KEY ("target_biomarker_id") REFERENCES "biomarkers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
