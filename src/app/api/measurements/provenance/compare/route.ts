/**
 * `GET /api/measurements/provenance/compare` — two sources of one metric side
 * by side over up to a year of UTC days, with the source the ladder picked
 * each day (#1204). Read-only; one aggregate query, at most one row per day
 * and source.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { apiSuccess, returnAllZodIssues } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { readSourceComparison } from "@/lib/provenance/source-provenance";
import { sourceComparisonQuerySchema } from "@/lib/validations/source-provenance";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (request: NextRequest) => {
  const { user } = await requireRecordAuth("read", "measurements");
  annotate({ action: { name: "measurement.provenance.compare" } });
  const params = new URL(request.url).searchParams;
  const parsed = sourceComparisonQuerySchema.safeParse({
    type: params.get("type") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    a: params.get("a") ?? undefined,
    b: params.get("b") ?? undefined,
  });
  if (!parsed.success) return returnAllZodIssues(parsed.error, 422);

  const result = await readSourceComparison({
    userId: user.id,
    ...parsed.data,
  });
  annotate({
    meta: {
      provenance_type: result.type,
      provenance_days: result.days.length,
      provenance_sources: result.sources.length,
    },
  });
  return apiSuccess(result);
});
