/**
 * `GET /api/dawarich/places?q=` — the instance's places, to pick the home
 * place from. Answered from Dawarich live (at most 200, filtered by `q`) and
 * never stored. 409 `dawarich.not_connected`, 502 `dawarich.unreachable`.
 * Part of the `environment` module; own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { returnAllZodIssues } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { dawarichPlacesQuerySchema } from "@/lib/validations/dawarich";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const parsed = dawarichPlacesQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "dawarich.invalid",
    });
  }

  return notImplemented("dawarich.places.get");
});
