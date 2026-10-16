/**
 * `PATCH /api/dawarich/settings` — the home place (an id on the Dawarich
 * instance) and the home country (ISO 3166-1 alpha-2) the daily values are
 * measured against. 422 `dawarich.home_place_unknown` for a place id the
 * instance does not have; 409 `dawarich.not_connected`; 502
 * `dawarich.unreachable` when the place cannot be checked. Part of the
 * `environment` module; own account only.
 *
 * A new home country re-judges the stored travel days at once. A new home
 * place needs the visits again, so the stored days are fetched again in the
 * background (up to a year).
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import {
  apiError,
  apiSuccess,
  returnAllZodIssues,
  safeJson,
} from "@/lib/api-response";
import { placeExists } from "@/lib/dawarich/client";
import {
  effectiveHomeCountry,
  loadDawarichConnection,
  saveDawarichPrefs,
} from "@/lib/dawarich/connection";
import { yesterdayKey } from "@/lib/dawarich/sync";
import { rejudgeTravelDays } from "@/lib/dawarich/travel";
import { prisma } from "@/lib/db";
import { enqueueDawarichSync } from "@/lib/jobs/dawarich-sync";
import { annotate } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { shiftDateKey } from "@/lib/tz/format";
import { resolveUserTimezone } from "@/lib/tz/resolver";
import {
  DAWARICH_SYNC_MAX_DAYS,
  dawarichSettingsSchema,
} from "@/lib/validations/dawarich";

export const PATCH = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  annotate({ action: { name: "dawarich.settings.update" } });
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

  const stored = await loadDawarichConnection(user.id);
  if (!stored) {
    return apiError("Dawarich is not connected", 409, {
      errorCode: "dawarich.not_connected",
    });
  }
  const { prefs } = stored;
  const { homePlaceId, homeCountry } = parsed.data;

  if (homePlaceId != null && homePlaceId !== prefs.homePlaceId) {
    let known: boolean;
    try {
      known = await placeExists(stored.connection, homePlaceId);
    } catch {
      return apiError("Could not reach the Dawarich instance", 502, {
        errorCode: "dawarich.unreachable",
      });
    }
    if (!known) {
      return apiError("The Dawarich instance has no such place", 422, {
        errorCode: "dawarich.home_place_unknown",
      });
    }
  }

  const next = {
    ...prefs,
    homePlaceId: homePlaceId === undefined ? prefs.homePlaceId : homePlaceId,
    homeCountry: homeCountry === undefined ? prefs.homeCountry : homeCountry,
  };
  await saveDawarichPrefs(user.id, next);

  const countryChanged =
    effectiveHomeCountry(next) !== effectiveHomeCountry(prefs);
  if (countryChanged) {
    await rejudgeTravelDays(user.id, effectiveHomeCountry(next));
  }
  let refetch = "none";
  if (next.homePlaceId !== prefs.homePlaceId) {
    const oldest = await prisma.dawarichDay.findFirst({
      where: { userId: user.id },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    if (oldest) {
      const yesterday = yesterdayKey(await resolveUserTimezone(user.id));
      const floor = shiftDateKey(yesterday, -(DAWARICH_SYNC_MAX_DAYS - 1));
      refetch = await enqueueDawarichSync({
        userId: user.id,
        fromDate: oldest.date > floor ? oldest.date : floor,
      });
    }
  }
  annotate({
    meta: {
      home_place_set: next.homePlaceId !== null,
      home_country_set: next.homeCountry !== null,
      travel_rejudged: countryChanged,
      refetch,
    },
  });

  return apiSuccess({
    homePlaceId: next.homePlaceId,
    homeCountry: next.homeCountry,
  });
});
