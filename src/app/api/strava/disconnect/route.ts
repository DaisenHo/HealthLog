import { apiHandler, requireAuth } from "@/lib/api-handler";
import { disconnectOAuth } from "@/lib/integrations/oauth-kit/disconnect";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * v1.28.x — disconnect Strava for the current user.
 *
 * Best-effort deauthorize at Strava, then clear the stored access + refresh
 * token + athlete id on `User` and park the integration status at
 * `disconnected`. Imported `source = STRAVA` workouts are left intact; a
 * reconnect resumes sync.
 */
export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "strava.disconnect" } });

  const rl = await checkRateLimit(`strava-disconnect:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return apiError("Too many requests", 429, {
      headers: rateLimitHeaders(rl),
    });
  }

  if ((await disconnectOAuth("strava", user.id)) === "not_connected") {
    return apiError("No Strava connection", 404);
  }

  return apiSuccess({ disconnected: true });
});
