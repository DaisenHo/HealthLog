/**
 * `POST /api/dawarich/sync` — fetch the daily values again from `fromDate`
 * (at most 365 days back; default: the nightly window). 202
 * `{ enqueued }`; 409 `dawarich.not_connected`. Part of the `environment`
 * module; own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { dawarichSyncSchema } from "@/lib/validations/dawarich";

export const POST = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;
  const parsed = dawarichSyncSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "dawarich.invalid",
    });
  }

  return notImplemented("dawarich.sync");
});
