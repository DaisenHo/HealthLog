/**
 * OpenAPI route table — supplement composition (v1.43).
 *
 * Part of the medication route table; aggregated in `../index.ts`. The PUT
 * body reuses the runtime schema from
 * `@/lib/validations/medication-ingredients`.
 */
import type { ZodOpenApiObject } from "zod-openapi";
import { z } from "zod/v4";

import { medicationIngredientsPutSchema } from "@/lib/validations/medication-ingredients";

import {
  dataEnvelope,
  errorEnvelope,
  idempotencyKeyParameter,
  idempotentWrite,
  recordRefusal,
  stdResponses,
} from "../shared";
import { aiRunAccepted } from "../ai-run-accepted";
import {
  aiCheckFailedResponse,
  aiNoProviderResponse,
  aiRefusal403Description,
} from "../ai-refusal";

const NUTRIENTS_MODULE_OFF =
  'The opt-in `nutrients` module is off for this account: 403 `module.disabled` with `meta.module: "nutrients"`.';

export const medicationIngredient = z
  .object({
    nutrient: z.string().describe("Nutrient catalogue code."),
    amountPerUnit: z
      .number()
      .describe("Amount in one unit (tablet, capsule), canonical unit."),
    unit: z.string().describe("The catalogue's canonical unit for the code."),
    enteredAmount: z
      .number()
      .nullable()
      .describe("The amount as entered when it was entered in another unit."),
    enteredUnit: z
      .string()
      .nullable()
      .describe("The input unit it was entered in (e.g. `IU`)."),
    labelKey: z.string(),
    label: z.string().describe("The nutrient's name in the account language."),
  })
  .meta({
    id: "MedicationIngredient",
    description:
      "What one unit of a medication (usually a supplement) contains. Every taken dose adds `amountPerUnit × unitsPerDose` to the day's micronutrients under the source `SUPPLEMENT`.",
  });

const medicationIngredientsPutRequest = medicationIngredientsPutSchema.meta({
  id: "MedicationIngredientsPutRequest",
  description:
    "Replace the composition: 0..40 entries, one per nutrient code, `amount` > 0 in one of the code's `inputUnits` (`GET /api/nutrients/catalog`). `source` is `MANUAL` (default) or `LABEL_AI` after a label proposal was reviewed.",
});

export const supplementLabelExtractResult = z
  .object({
    ingredients: z.array(
      z.object({
        nutrient: z.string(),
        amount: z.number(),
        unit: z.string(),
        confidence: z.enum(["high", "low"]),
        printedText: z.string(),
      }),
    ),
    unmatched: z.array(z.object({ printedText: z.string() })),
    servingNote: z
      .string()
      .nullable()
      .describe('e.g. "per 2 capsules"; shown, never stored.'),
  })
  .meta({
    id: "SupplementLabelExtractResult",
    description:
      "The `result` of an AI run of kind `SUPPLEMENT_LABEL_EXTRACT`: a proposal only. Nothing is stored until the composition is saved through `PUT /api/medications/{id}/ingredients`.",
  });

export const medicationIngredientPaths: NonNullable<ZodOpenApiObject["paths"]> =
  {
    "/api/medications/{id}/ingredients": {
      put: {
        tags: ["Medications"],
        summary: "Replace a supplement's composition (v1.43)",
        description:
          'Stores the composition per unit in canonical units and re-counts every taken dose of this medication into the day\'s micronutrients: `recompute.queued` is true when the worker has the recompute (the rows follow within moments), false when it ran before this answer. Needs the `nutrients` module (403 `module.disabled`, `meta.module: "nutrients"`). Delegable at MANAGE on the `medications` domain. 404 `medications.notFound`; 422 `medications.ingredients.invalid` (body, duplicate code, or unknown code with `meta.index`); 422 `medications.ingredients.unitMismatch` with `meta.index` and `meta.allowedUnits`; 429 above 30 a minute per caller.',
        parameters: [idempotencyKeyParameter],
        requestParams: { path: z.object({ id: z.string() }) },
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: medicationIngredientsPutRequest },
          },
        },
        responses: {
          ...idempotentWrite(),
          "200": {
            description: "The stored composition.",
            content: {
              "application/json": {
                schema: dataEnvelope(
                  z.object({
                    ingredients: z.array(medicationIngredient),
                    recompute: z.object({ queued: z.boolean() }),
                  }),
                  "PutMedicationIngredientsResponse",
                ),
              },
            },
          },
          ...recordRefusal(NUTRIENTS_MODULE_OFF),
          "404": {
            description: "`medications.notFound`.",
            content: { "application/json": { schema: errorEnvelope } },
          },
          ...stdResponses,
        },
      },
    },
    "/api/medications/{id}/ingredients/extract": {
      post: {
        tags: ["Medications"],
        summary: "Read a supplement label (v1.43)",
        description:
          "Multipart `file` (JPEG, PNG, WebP or PDF, at most 10 MB; the bytes decide the type, not the header). HEIC is refused with `medications.ingredients.extract.fileType`: send the photo as JPEG. 202 with an AI run; poll `GET /api/ai-runs/{id}` (kind `SUPPLEMENT_LABEL_EXTRACT`, result `SupplementLabelExtractResult`). Amounts in the proposal are per single unit: a label printed per serving of several units is divided down, and `servingNote` says what was printed. Needs `ai.capabilities.supplementLabel.available` (refused like every AI capability, reason `usage_level` included) and the `nutrients` module. The account's own session only: provider work is never admitted inside somebody else's record. 404 `medications.notFound`; 422 `medications.ingredients.extract.fileType`; 413 `medications.ingredients.extract.fileTooLarge`; 429 `medications.ingredients.extract.rateLimited` (six an hour) or `medications.ingredients.extract.budgetExceeded` (the day's AI budget). A run that fails carries `medications.ingredients.extract.failed`.",
        requestParams: { path: z.object({ id: z.string() }) },
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: z.object({
                file: z.string().meta({ format: "binary" }),
              }),
            },
          },
        },
        responses: {
          ...aiRunAccepted,
          "403": {
            description: `${NUTRIENTS_MODULE_OFF} ${aiRefusal403Description("supplementLabel")}`,
            content: { "application/json": { schema: errorEnvelope } },
          },
          "404": {
            description: "`medications.notFound`.",
            content: { "application/json": { schema: errorEnvelope } },
          },
          "413": {
            description: "`medications.ingredients.extract.fileTooLarge`.",
            content: { "application/json": { schema: errorEnvelope } },
          },
          ...stdResponses,
          "422": {
            description: `\`medications.ingredients.extract.fileType\`: the upload is not a JPEG, PNG, WebP or PDF, or carries no \`file\` field. ${aiNoProviderResponse("supplementLabel").description}`,
            content: { "application/json": { schema: errorEnvelope } },
          },
          "503": aiCheckFailedResponse,
        },
      },
    },
  };
