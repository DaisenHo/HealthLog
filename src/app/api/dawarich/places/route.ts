/**
 * `GET /api/dawarich/places?q=` — the instance's places, to pick the home
 * place from. Answered from Dawarich live (at most 200, filtered by `q`) and
 * never stored. 409 `dawarich.not_connected`, 502 `dawarich.unreachable`.
 * Part of the `environment` module; own account only, thirty reads a minute.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError, apiSuccess, returnAllZodIssues } from "@/lib/api-response";
import { fetchPlaces } from "@/lib/dawarich/client";
import { loadDawarichConnection } from "@/lib/dawarich/connection";
import { annotate } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { checkRateLimit } from "@/lib/rate-limit";
import { dawarichPlacesQuerySchema } from "@/lib/validations/dawarich";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  annotate({ action: { name: "dawarich.places" } });
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

  const rl = await checkRateLimit(`dawarich-places:${user.id}`, 30, 60_000);
  if (!rl.allowed) {
    return apiError("Too many requests, try again later", 429, {
      errorCode: "dawarich.rate_limited",
    });
  }

  const stored = await loadDawarichConnection(user.id);
  if (!stored) {
    return apiError("Dawarich is not connected", 409, {
      errorCode: "dawarich.not_connected",
    });
  }

  try {
    const places = await fetchPlaces(stored.connection, parsed.data.q);
    annotate({ meta: { places: places.length } });
    return apiSuccess({ places });
  } catch {
    return apiError("Could not reach the Dawarich instance", 502, {
      errorCode: "dawarich.unreachable",
    });
  }
});
