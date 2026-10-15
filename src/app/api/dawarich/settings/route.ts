/**
 * `PATCH /api/dawarich/settings` — the home place (an id on the Dawarich
 * instance) and the home country (ISO 3166-1 alpha-2) the daily values are
 * measured against. 422 `dawarich.home_place_unknown` for a place id the
 * instance does not have. Part of the `environment` module; own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { dawarichSettingsSchema } from "@/lib/validations/dawarich";

export const PATCH = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;
  const parsed = dawarichSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "dawarich.invalid",
    });
  }

  return notImplemented("dawarich.settings.patch");
});
