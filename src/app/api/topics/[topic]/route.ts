/**
 * `GET /api/topics/{topic}` — one topic page (preview).
 *
 * The topic's signals with their usual ranges, the side-by-side series for the
 * chosen window, the relationships between its signals (14 paired days before
 * anything is said), the 90-day trends, the signals it could show but holds
 * nothing for, and its extra blocks (training load, lab markers with their
 * trend, screener trends, today's place in the cycle). Every figure is
 * computed on the server from existing reads; no model is involved.
 *
 * 404 `topics.preview_off` when the viewer has not switched the preview on,
 * `topics.not_available` when the record's module switches do not offer the
 * topic. Admission declares the whole record, like the overview.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { apiError, apiSuccess, returnAllZodIssues } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkAnalyticsReadRateLimit } from "@/lib/rate-limit";
import { hasTopicsPreview, loadTopicDetail } from "@/lib/topics/service";
import {
  topicDetailQuerySchema,
  topicPathSchema,
} from "@/lib/validations/topics";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ topic: string }> };

export const GET = apiHandler(
  async (request: NextRequest, { params }: RouteParams) => {
    const { user, actor, grantId } = await requireRecordAuth("read", "record");
    annotate({ action: { name: "topics.detail.read" } });

    if (!(await hasTopicsPreview(actor.id))) {
      return apiError("Topics are a preview that is switched off", 404, {
        errorCode: "topics.preview_off",
      });
    }

    const path = topicPathSchema.safeParse(await params);
    if (!path.success) {
      return apiError("No such topic", 404, { errorCode: "topics.not_found" });
    }
    const query = topicDetailQuerySchema.safeParse({
      range: request.nextUrl.searchParams.get("range") ?? undefined,
    });
    if (!query.success) return returnAllZodIssues(query.error, 422);

    const rl = await checkAnalyticsReadRateLimit(actor.id);
    if (!rl.allowed) {
      return apiError("Too many analytics requests. Please retry later.", 429);
    }

    const detail = await loadTopicDetail({
      userId: user.id,
      grantId,
      topic: path.data.topic,
      range: query.data.range,
      now: new Date(),
    });
    if (!detail) {
      return apiError("This topic is not available for this record", 404, {
        errorCode: "topics.not_available",
      });
    }
    annotate({
      meta: {
        topic: detail.key,
        topic_range: detail.range,
        topic_status: detail.status,
        topic_relationships_linked: detail.relationships.filter(
          (r) => r.status === "linked",
        ).length,
      },
    });
    return apiSuccess(detail);
  },
);
