/**
 * `POST /api/environment/travel/suggestions/{id}/dismiss` — never suggest
 * this run of travel days again. Answers `{ dismissed: true }`; 404
 * `environment.travel_suggestion.not_found` for an id that is not an open
 * suggestion. Part of the `environment` module; own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  openDawarichPrefs,
  saveDawarichPrefs,
} from "@/lib/dawarich/connection";
import { listTravelSuggestions } from "@/lib/dawarich/travel";
import { prisma } from "@/lib/db";
import { annotate } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { userDayKey } from "@/lib/tz/format";
import { resolveUserTimezone } from "@/lib/tz/resolver";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = apiHandler(
  async (_request: NextRequest, { params }: RouteParams) => {
    const { user } = await requireAuth();
    const { id } = await params;
    annotate({ action: { name: "environment.travel_suggestion.dismiss" } });
    const gate = await requireModuleEnabled(user.id, "environment");
    if (!gate.enabled) return gate.response;

    const notFound = () =>
      apiError("No such travel suggestion", 404, {
        errorCode: "environment.travel_suggestion.not_found",
      });
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { dawarichUrlEncrypted: true, dawarichPrefsEncrypted: true },
    });
    if (!row?.dawarichUrlEncrypted || id.length > 64) return notFound();
    const prefs = openDawarichPrefs(row.dawarichPrefsEncrypted);
    const today = userDayKey(new Date(), await resolveUserTimezone(user.id));
    const open = await listTravelSuggestions(
      user.id,
      today,
      new Set(prefs.dismissedSuggestionIds),
    );
    if (!open.some((s) => s.id === id)) return notFound();

    await saveDawarichPrefs(user.id, {
      ...prefs,
      dismissedSuggestionIds: [...prefs.dismissedSuggestionIds, id],
    });
    return apiSuccess({ dismissed: true as const });
  },
);
