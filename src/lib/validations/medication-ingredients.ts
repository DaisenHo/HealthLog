/**
 * v1.43 — a supplement's composition per unit (tablet, capsule).
 *
 * The shape is checked here; whether `nutrient` is a catalogue code and
 * `unit` one of its input units is checked against the nutrient catalogue by
 * the route (422 `medications.ingredients.unitMismatch` carries the index and
 * the allowed units), so the catalogue stays the one place units live.
 */
import { z } from "zod/v4";

export const MEDICATION_INGREDIENTS_MAX = 40;
export const MEDICATION_INGREDIENT_SOURCES = ["MANUAL", "LABEL_AI"] as const;

export const medicationIngredientInputSchema = z.strictObject({
  nutrient: z.string().trim().min(1).max(40),
  amount: z.number().finite().positive(),
  unit: z.string().trim().min(1).max(8),
});

export const medicationIngredientsPutSchema = z
  .strictObject({
    ingredients: z
      .array(medicationIngredientInputSchema)
      .max(MEDICATION_INGREDIENTS_MAX),
    source: z.enum(MEDICATION_INGREDIENT_SOURCES).optional().default("MANUAL"),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.ingredients.forEach((ingredient, index) => {
      if (seen.has(ingredient.nutrient)) {
        ctx.addIssue({
          code: "custom",
          path: ["ingredients", index, "nutrient"],
          message: "Each nutrient may appear once",
        });
      }
      seen.add(ingredient.nutrient);
    });
  });
export type MedicationIngredientsPutInput = z.infer<
  typeof medicationIngredientsPutSchema
>;

/** Label photo upload limits for `POST /api/medications/{id}/ingredients/extract`. */
export const SUPPLEMENT_LABEL_MAX_BYTES = 10 * 1024 * 1024;
