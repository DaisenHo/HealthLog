import { apiHandler, requireAuth } from "@/lib/api-handler";
import { disconnectOAuth } from "@/lib/integrations/oauth-kit/disconnect";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * v1.17.0 — disconnect Polar for the current user.
 *
 * Clears the stored OAuth token + member id on `User` and parks the integration
 * status at `disconnected`. Imported `source = POLAR` measurements are left
 * intact (they are the user's historical readings); a reconnect resumes sync.
 */
export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "polar.disconnect" } });

  const rl = await checkRateLimit(`polar-disconnect:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return apiError("Too many requests", 429, {
      headers: rateLimitHeaders(rl),
    });
  }

  if ((await disconnectOAuth("polar", user.id)) === "not_connected") {
    return apiError("No Polar connection", 404);
  }

  return apiSuccess({ disconnected: true });
});
