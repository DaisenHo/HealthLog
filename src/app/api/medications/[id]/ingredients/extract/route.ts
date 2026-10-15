/**
 * `POST /api/medications/{id}/ingredients/extract` — read a supplement label.
 *
 * Multipart `file` (JPEG, PNG, HEIC, WebP or PDF, at most 10 MB). Answers 202
 * with an AI run; `GET /api/ai-runs/{id}` (`SUPPLEMENT_LABEL_EXTRACT`) carries
 * a proposal of ingredients, unmatched lines and a serving note. Nothing is
 * stored until the composition is saved through the PUT beside this route.
 * Gated by the `supplementLabel` AI capability (a `frugal` usage level makes
 * it unavailable), six runs an hour, budget reserved like the other document
 * AI runs. Needs the `nutrients` module.
 *
 * Contract authority: `requireRecordAuth("manage", "medications")`. Until the
 * extraction lands the stub resolves the caller's own record only.
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
    const gate = await requireModuleEnabled(user.id, "nutrients");
    if (!gate.enabled) return gate.response;

    return notImplemented("medications.ingredients.extract");
  },
);
