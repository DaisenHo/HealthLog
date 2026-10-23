/**
 * `GET /api/topics` — the topic overview (preview).
 *
 * One tile per topic the record holds data for: a headline value, a rule-based
 * sentence and a sparkline, computed on the server from the same daily values
 * the single-metric pages draw. No model is involved and no AI gate applies.
 *
 * The preview is the viewer's own opt-in (Settings > System > Preview
 * features): with it off the route answers 404 `topics.preview_off`, the same
 * as for a path that does not exist. The topics, signals and blocks follow the
 * RECORD's module switches; a topic whose every module is off is named in
 * `hiddenByModule`, an offered topic with nothing recorded in `empty`.
 *
 * Admission declares the whole record, like the timeline: a topic lays several
 * sections side by side, so a grant scoped to some of them does not open it.
 */
import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { apiError, apiSuccess } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkAnalyticsReadRateLimit } from "@/lib/rate-limit";
import { hasTopicsPreview, loadTopicOverview } from "@/lib/topics/service";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user, actor, grantId } = await requireRecordAuth("read", "record");
  annotate({ action: { name: "topics.overview.read" } });

  if (!(await hasTopicsPreview(actor.id))) {
    return apiError("Topics are a preview that is switched off", 404, {
      errorCode: "topics.preview_off",
    });
  }

  // The shared analytics-read budget, spent by the person reading.
  const rl = await checkAnalyticsReadRateLimit(actor.id);
  if (!rl.allowed) {
    return apiError("Too many analytics requests. Please retry later.", 429);
  }

  const overview = await loadTopicOverview({
    userId: user.id,
    grantId,
    now: new Date(),
  });
  annotate({
    meta: {
      topics_shown: overview.topics.length,
      topics_empty: overview.empty.length,
      topics_hidden: overview.hiddenByModule.length,
    },
  });
  return apiSuccess(overview);
});
