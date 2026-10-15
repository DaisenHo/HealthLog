/**
 * `PUT /api/auth/me/ai-usage` — the account's own AI usage level (#1217).
 *
 * `{ level: "frugal" | "standard" | "full" | null }`; `null` follows the
 * instance default. A level above the operator's ceiling is refused with 422
 * `ai.usage.aboveCeiling`, never capped silently. Answers the resolved
 * `AiUsageState`, the same block `GET /api/auth/me` publishes as `ai.usage`.
 * Own account only (cookie or a full-scope token), at most 30 writes an hour.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError, returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { checkRateLimit } from "@/lib/rate-limit";
import { aiUsagePutSchema } from "@/lib/validations/ai-usage";

export const dynamic = "force-dynamic";

export const PUT = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();

  const rl = await checkRateLimit(`ai-usage:${user.id}`, 30, 60 * 60 * 1000);
  if (!rl.allowed) {
    return apiError("Too many changes, try again later", 429, {
      errorCode: "ai.usage.rateLimited",
    });
  }

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;
  const parsed = aiUsagePutSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "ai.usage.invalid",
    });
  }

  return notImplemented("auth.me.ai_usage.put");
});
