/**
 * `POST /api/anamnesis/life-circumstances/confirm` — "still true" for one
 * section (#614). `{ section }`; stores the confirmation instant only, never a
 * new revision, and answers `{ section, lastConfirmedAt }`. Own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { lifeConfirmSchema } from "@/lib/validations/life-circumstances";

export const POST = apiHandler(async (request: NextRequest) => {
  await requireAuth();

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;
  const parsed = lifeConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "anamnesis.lifeConfirm.invalid",
    });
  }

  return notImplemented("anamnesis.life_circumstances.confirm");
});
