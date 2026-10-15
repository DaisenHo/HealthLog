/**
 * `PUT /api/medications/{id}/ingredients` — a supplement's composition per
 * unit (tablet, capsule).
 *
 * `{ ingredients: [{ nutrient, amount, unit }], source }` replaces the set.
 * Amounts are stored in the catalogue's canonical unit (an input unit such as
 * `IU` is kept beside it as `enteredAmount` / `enteredUnit`). The change
 * re-counts every taken dose of this medication into the day's micronutrients
 * (`recompute.queued`). Needs the `nutrients` module.
 *
 * Contract authority: `requireRecordAuth("manage", "medications")`. Until the
 * composition lands the stub resolves the caller's own record only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { withIdempotency } from "@/lib/idempotency";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { medicationIngredientsPutSchema } from "@/lib/validations/medication-ingredients";

type RouteParams = { params: Promise<{ id: string }> };

export const PUT = apiHandler(
  withIdempotency<[NextRequest, RouteParams]>(putIngredients),
);

async function putIngredients(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const { user } = await requireAuth();
  await params;
  const gate = await requireModuleEnabled(user.id, "nutrients");
  if (!gate.enabled) return gate.response;

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 16 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = medicationIngredientsPutSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "medications.ingredients.invalid",
    });
  }

  return notImplemented("medications.ingredients.put");
}
