import { NextRequest } from "next/server";

import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { apiSuccess, returnAllZodIssues } from "@/lib/api-response";
import { loadLabOverview } from "@/lib/labs/overview";
import { annotate } from "@/lib/logging/context";
import { labOverviewQuerySchema } from "@/lib/validations/labs";

/**
 * `GET /api/labs/overview` — one entry per biomarker over the caller's whole
 * live lab history: the newest reading, the reading count and a short trend.
 * The Labs list renders from this instead of grouping a capped page of raw
 * rows, so a marker measured only long ago still has its row. Same read gate
 * as `GET /api/labs` (`requireRecordAuth("read", "labs")`).
 */
export const GET = apiHandler(async (request: NextRequest) => {
  const { user } = await requireRecordAuth("read", "labs");

  const parsed = labOverviewQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!parsed.success) {
    annotate({
      action: { name: "labs.overview.validation-failed" },
      meta: { issue_count: parsed.error.issues.length },
    });
    return returnAllZodIssues(parsed.error, 422);
  }

  const markers = await loadLabOverview(user.id);
  annotate({
    action: { name: "labs.overview" },
    meta: { markers: markers.length },
  });
  return apiSuccess({ markers });
});
