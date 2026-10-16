-- Supplement composition.
--
-- What one unit (tablet, capsule) of a medication contains, per nutrient, in
-- the nutrient catalogue's canonical unit. One row per (medication, nutrient).
-- The entered amount and unit are kept when the input unit differed (IU for
-- vitamin D). Taken doses add their share to `nutrient_intake_days` under the
-- text source `SUPPLEMENT`, which needs no schema change. Reading a label
-- photo is a background document AI run of its own kind; the value is added
-- only, nothing here uses it.

-- AlterEnum
ALTER TYPE "document_ai_run_kind" ADD VALUE 'SUPPLEMENT_LABEL_EXTRACT';

-- CreateTable
CREATE TABLE "medication_ingredients" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "medication_id" TEXT NOT NULL,
    "nutrient" VARCHAR(40) NOT NULL,
    "amount_per_unit" DOUBLE PRECISION NOT NULL,
    "unit" VARCHAR(8) NOT NULL,
    "entered_amount" DOUBLE PRECISION,
    "entered_unit" VARCHAR(8),
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medication_ingredients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "medication_ingredients_amount_per_unit_check" CHECK ("amount_per_unit" > 0),
    CONSTRAINT "medication_ingredients_source_check" CHECK ("source" IN ('MANUAL', 'LABEL_AI'))
);

-- CreateIndex
CREATE INDEX "medication_ingredients_user_id_idx" ON "medication_ingredients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "medication_ingredients_medication_id_nutrient_key" ON "medication_ingredients"("medication_id", "nutrient");

-- AddForeignKey
ALTER TABLE "medication_ingredients" ADD CONSTRAINT "medication_ingredients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_ingredients" ADD CONSTRAINT "medication_ingredients_medication_id_fkey" FOREIGN KEY ("medication_id") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
