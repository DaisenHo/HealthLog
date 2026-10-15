-- Relation links that close the remaining pairs of the relation matrix.
--
-- Lab result and document, visit and medication, visit and vaccination,
-- medication and document, medication and condition (indication). Same shape
-- as `encounter_lab_links`: both ends cascade, the pair is unique.

-- CreateTable
CREATE TABLE "lab_result_document_links" (
    "id" TEXT NOT NULL,
    "lab_result_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_result_document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_medication_links" (
    "id" TEXT NOT NULL,
    "encounter_id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_medication_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encounter_vaccination_links" (
    "id" TEXT NOT NULL,
    "encounter_id" TEXT NOT NULL,
    "vaccination_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_vaccination_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_document_links" (
    "id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_document_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_condition_links" (
    "id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medication_condition_links_pkey" PRIMARY KEY ("id")
);


-- CreateIndex
CREATE INDEX "lab_result_document_links_document_id_idx" ON "lab_result_document_links"("document_id");

-- CreateIndex
CREATE INDEX "lab_result_document_links_user_id_idx" ON "lab_result_document_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_result_document_links_lab_result_id_document_id_key" ON "lab_result_document_links"("lab_result_id", "document_id");

-- CreateIndex
CREATE INDEX "encounter_medication_links_medication_id_idx" ON "encounter_medication_links"("medication_id");

-- CreateIndex
CREATE INDEX "encounter_medication_links_user_id_idx" ON "encounter_medication_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_medication_links_encounter_id_medication_id_key" ON "encounter_medication_links"("encounter_id", "medication_id");

-- CreateIndex
CREATE INDEX "encounter_vaccination_links_vaccination_id_idx" ON "encounter_vaccination_links"("vaccination_id");

-- CreateIndex
CREATE INDEX "encounter_vaccination_links_user_id_idx" ON "encounter_vaccination_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounter_vaccination_links_encounter_id_vaccination_id_key" ON "encounter_vaccination_links"("encounter_id", "vaccination_id");

-- CreateIndex
CREATE INDEX "medication_document_links_document_id_idx" ON "medication_document_links"("document_id");

-- CreateIndex
CREATE INDEX "medication_document_links_user_id_idx" ON "medication_document_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_document_links_medication_id_document_id_key" ON "medication_document_links"("medication_id", "document_id");

-- CreateIndex
CREATE INDEX "medication_condition_links_episode_id_idx" ON "medication_condition_links"("episode_id");

-- CreateIndex
CREATE INDEX "medication_condition_links_user_id_idx" ON "medication_condition_links"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_condition_links_medication_id_episode_id_key" ON "medication_condition_links"("medication_id", "episode_id");

-- AddForeignKey
ALTER TABLE "lab_result_document_links" ADD CONSTRAINT "lab_result_document_links_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_document_links" ADD CONSTRAINT "lab_result_document_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inbound_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_document_links" ADD CONSTRAINT "lab_result_document_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_medication_links" ADD CONSTRAINT "encounter_medication_links_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_medication_links" ADD CONSTRAINT "encounter_medication_links_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_medication_links" ADD CONSTRAINT "encounter_medication_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_vaccination_links" ADD CONSTRAINT "encounter_vaccination_links_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_vaccination_links" ADD CONSTRAINT "encounter_vaccination_links_vaccination_id_fkey" FOREIGN KEY ("vaccination_id") REFERENCES "vaccination_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_vaccination_links" ADD CONSTRAINT "encounter_vaccination_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_document_links" ADD CONSTRAINT "medication_document_links_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_document_links" ADD CONSTRAINT "medication_document_links_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "inbound_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_document_links" ADD CONSTRAINT "medication_document_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_condition_links" ADD CONSTRAINT "medication_condition_links_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_condition_links" ADD CONSTRAINT "medication_condition_links_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "illness_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_condition_links" ADD CONSTRAINT "medication_condition_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
