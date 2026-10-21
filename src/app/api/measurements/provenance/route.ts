/**
 * `GET /api/measurements/provenance` — which sources delivered a metric on a
 * day, which one the source-priority ladder picked, and why (#1204, #1108,
 * #576). Read-only; the explanation comes from the same rank SQL the charts
 * and summaries pick with (`src/lib/provenance/source-provenance.ts`).
 */
import { NextRequest } from "next/server";

import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { apiSuccess, returnAllZodIssues } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { readDayProvenance } from "@/lib/provenance/source-provenance";
import { dayProvenanceQuerySchema } from "@/lib/validations/source-provenance";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (request: NextRequest) => {
  const { user } = await requireRecordAuth("read", "measurements");
  annotate({ action: { name: "measurement.provenance.day" } });
  const params = new URL(request.url).searchParams;
  const parsed = dayProvenanceQuerySchema.safeParse({
    type: params.get("type") ?? undefined,
    date: params.get("date") ?? undefined,
  });
  if (!parsed.success) return returnAllZodIssues(parsed.error, 422);

  const result = await readDayProvenance({
    userId: user.id,
    type: parsed.data.type,
    date: parsed.data.date,
  });
  annotate({
    meta: {
      provenance_type: result.type,
      provenance_sources: result.sources.length,
      provenance_pick_reason: result.pickReason ?? "none",
    },
  });
  return apiSuccess(result);
});
