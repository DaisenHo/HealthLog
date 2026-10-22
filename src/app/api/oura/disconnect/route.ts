import { apiHandler, requireAuth } from "@/lib/api-handler";
import { disconnectOAuth } from "@/lib/integrations/oauth-kit/disconnect";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/**
 * v1.17.0 — disconnect Oura for the current user.
 *
 * Clears the stored access + refresh token on `User` and parks the integration
 * status at `disconnected`. Imported `source = OURA` measurements are left
 * intact; a reconnect resumes sync.
 */
export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "oura.disconnect" } });

  const rl = await checkRateLimit(`oura-disconnect:${user.id}`, 20, 60_000);
  if (!rl.allowed) {
    return apiError("Too many requests", 429, {
      headers: rateLimitHeaders(rl),
    });
  }

  if ((await disconnectOAuth("oura", user.id)) === "not_connected") {
    return apiError("No Oura connection", 404);
  }

  return apiSuccess({ disconnected: true });
});
