/**
 * `GET /api/environment/travel/suggestions` — runs of consecutive Dawarich
 * travel days no stored trip covers yet, as `{ id, startDate, endDate,
 * countryCode }`. Accepting one goes through `POST /api/environment/travel`
 * (the person picks the place); dismissing through the sibling route. Part of
 * the `environment` module; own account only. Without a Dawarich connection
 * the list is empty.
 */
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiSuccess } from "@/lib/api-response";
import { openDawarichPrefs } from "@/lib/dawarich/connection";
import { listTravelSuggestions } from "@/lib/dawarich/travel";
import { prisma } from "@/lib/db";
import { annotate } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { userDayKey } from "@/lib/tz/format";
import { resolveUserTimezone } from "@/lib/tz/resolver";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "environment.travel_suggestions.list" } });
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const row = await prisma.user.findUnique({
    where: { id: user.id },
    select: { dawarichUrlEncrypted: true, dawarichPrefsEncrypted: true },
  });
  if (!row?.dawarichUrlEncrypted) return apiSuccess({ suggestions: [] });
  const prefs = openDawarichPrefs(row.dawarichPrefsEncrypted);
  const today = userDayKey(new Date(), await resolveUserTimezone(user.id));
  const suggestions = await listTravelSuggestions(
    user.id,
    today,
    new Set(prefs.dismissedSuggestionIds),
  );
  annotate({ meta: { suggestions: suggestions.length } });
  return apiSuccess({ suggestions });
});
