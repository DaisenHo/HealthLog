/**
 * `POST /api/anamnesis/life-circumstances/confirm` — "still true" for one
 * section (#614). `{ section }`; stores the confirmation instant only, never a
 * new revision, and answers `{ section, lastConfirmedAt }`. Own account only,
 * like the answers' AI switches: it vouches for the person's own account of
 * their life, which a delegate cannot do for them.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiSuccess, returnAllZodIssues, safeJson } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { confirmLifeSection } from "@/lib/profile/life-circumstances";
import { lifeConfirmSchema } from "@/lib/validations/life-circumstances";

export const POST = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();

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

  const lastConfirmedAt = await confirmLifeSection(
    user.id,
    parsed.data.section,
  );
  annotate({
    action: { name: "anamnesis.life_section.confirm" },
    meta: { section: parsed.data.section },
  });
  return apiSuccess({ section: parsed.data.section, lastConfirmedAt });
});
