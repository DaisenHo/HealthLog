/**
 * `POST /api/dawarich/connect` — connect a Dawarich instance (movement
 * context, daily values only).
 *
 * `{ url, apiKey }`; both sealed at rest. The URL must resolve to a public
 * host unless its origin is listed in `DAWARICH_PRIVATE_ORIGINS` (422
 * `private_origin_not_approved`). The key is checked against the instance
 * before anything is stored, then a 30-day backfill starts. Part of the
 * `environment` module; own account only, ten attempts a minute.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError, returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { checkRateLimit } from "@/lib/rate-limit";
import { dawarichConnectSchema } from "@/lib/validations/dawarich";

export const POST = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const rl = await checkRateLimit(`dawarich-connect:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return apiError("Too many attempts, try again later", 429, {
      errorCode: "dawarich.rate_limited",
    });
  }

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 4 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = dawarichConnectSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "dawarich.invalid",
    });
  }

  return notImplemented("dawarich.connect");
});
