import { prisma } from "@/lib/db";
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { auditLog } from "@/lib/auth/audit";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate, getEvent } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { markDisconnected } from "@/lib/integrations/status";
import { deauthorize } from "@/lib/strava/client";
import {
  getStravaConnection,
  STRAVA_DISCONNECTED,
} from "@/lib/strava/credentials";

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

  const connection = await getStravaConnection(user.id);
  if (!connection) {
    return apiError("No Strava connection", 404);
  }

  // Best-effort revoke at Strava; a Strava-side outage must never block the
  // local disconnect.
  try {
    await deauthorize(connection.accessToken);
  } catch (err) {
    getEvent()?.addWarning(`strava: deauthorize failed on disconnect: ${err}`);
  }

  await prisma.user.update({
    where: { id: user.id },
    data: STRAVA_DISCONNECTED,
  });

  await auditLog("strava.disconnect", { userId: user.id });
  await markDisconnected(user.id, "strava");

  return apiSuccess({ disconnected: true });
});
