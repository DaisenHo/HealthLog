/**
 * `POST /api/biomarkers/{id}/merge` — fold other markers into this one (D1223).
 *
 * `{id}` is the marker that stays. `{ sourceIds, dryRun }`: the readings of
 * every source move onto the target in one transaction, converted where the
 * analyte's conversion table knows the unit, the source names become aliases
 * (`MERGE`), one `biomarker_merges` row is written per source and the sources
 * are deleted. A pair of units without a known conversion refuses the whole
 * merge (422 `labs.biomarker.merge.unitMismatch`); nothing moves. `dryRun`
 * answers the same result and writes nothing. There is no undo.
 *
 * Contract authority: `requireRecordAuth("manage", "labs")` with the shared
 * record-write ceiling. Until the merge lands the stub resolves the caller's
 * own record only.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError, returnAllZodIssues, safeJson } from "@/lib/api-response";
import { notImplemented } from "@/lib/http/not-implemented";
import { withIdempotency } from "@/lib/idempotency";
import { checkRecordWriteRateLimit } from "@/lib/rate-limit";
import { biomarkerMergeSchema } from "@/lib/validations/biomarker-merge";

type RouteParams = { params: Promise<{ id: string }> };

export const POST = apiHandler(
  withIdempotency<[NextRequest, RouteParams]>(mergeBiomarkers),
);

async function mergeBiomarkers(
  request: NextRequest,
  { params }: RouteParams,
): Promise<Response> {
  const { user } = await requireAuth();
  const { id } = await params;

  const writeRl = await checkRecordWriteRateLimit(user.id);
  if (!writeRl.allowed) {
    return apiError("Too many writes, try again later", 429, {
      errorCode: "record_write.rate_limited",
    });
  }

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 4 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = biomarkerMergeSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "labs.biomarker.merge.invalid",
    });
  }
  if (parsed.data.sourceIds.includes(id)) {
    return apiError("The target cannot be one of the sources", 422, {
      errorCode: "labs.biomarker.merge.invalid",
    });
  }

  return notImplemented("labs.biomarker.merge");
}
