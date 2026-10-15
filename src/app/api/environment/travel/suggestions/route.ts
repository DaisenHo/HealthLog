/**
 * `GET /api/environment/travel/suggestions` — runs of consecutive Dawarich
 * travel days no stored trip covers yet, as `{ id, startDate, endDate,
 * countryCode }`. Accepting one goes through `POST /api/environment/travel`
 * (the person picks the place); dismissing through the sibling route. Part of
 * the `environment` module; own account only.
 */
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;
  return notImplemented("environment.travel_suggestions.get");
});
