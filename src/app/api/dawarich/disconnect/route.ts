/**
 * `POST /api/dawarich/disconnect` — forget the connection; with
 * `deleteData: true` the stored days go too. Answers
 * `{ disconnected: true, deletedDays }`. Part of the `environment` module;
 * own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { dawarichDisconnectSchema } from "@/lib/validations/dawarich";

export const POST = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 1024,
  });
  if (jsonError) return jsonError;
  const parsed = dawarichDisconnectSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "dawarich.invalid",
    });
  }

  return notImplemented("dawarich.disconnect");
});
