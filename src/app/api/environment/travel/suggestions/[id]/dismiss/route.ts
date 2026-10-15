/**
 * `POST /api/environment/travel/suggestions/{id}/dismiss` — never suggest
 * this run of travel days again. Answers `{ dismissed: true }`; 404
 * `environment.travel_suggestion.not_found`. Part of the `environment`
 * module; own account only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = apiHandler(
  async (_request: NextRequest, { params }: RouteParams) => {
    const { user } = await requireAuth();
    await params;
    const gate = await requireModuleEnabled(user.id, "environment");
    if (!gate.enabled) return gate.response;
    return notImplemented("environment.travel_suggestion.dismiss");
  },
);
