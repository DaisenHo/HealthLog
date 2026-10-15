/**
 * `PATCH /api/anamnesis/life-circumstances/ai-sections` — switch which
 * life-circumstance sections may reach the AI (#614).
 *
 * `{ sections: { <SECTION>: boolean }, baseUpdatedAt? }` with at least one
 * key, over `SMOKING_STATUS`, `ALCOHOL_PATTERN`, `SHIFT_SCHEDULE`, `ACTIVITY`,
 * `WORK`, `HABITS`, `GOALS`. Sections not named keep their state. A stale
 * `baseUpdatedAt` is 409 `about_me_conflict`, the token `about-me` uses.
 * Own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { lifeAiSectionsPatchSchema } from "@/lib/validations/life-circumstances";

export const PATCH = apiHandler(async (request: NextRequest) => {
  await requireAuth();

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 4 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = lifeAiSectionsPatchSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "anamnesis.lifeSections.invalid",
    });
  }

  return notImplemented("anamnesis.life_circumstances.ai_sections.patch");
});
