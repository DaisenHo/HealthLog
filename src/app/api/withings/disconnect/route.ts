import { apiHandler, requireAuth } from "@/lib/api-handler";
import { disconnectOAuth } from "@/lib/integrations/oauth-kit/disconnect";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";

/**
 * Disconnect Withings integration for the current user.
 */
export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "withings.disconnect" } });

  if ((await disconnectOAuth("withings", user.id)) === "not_connected") {
    return apiError("No Withings connection", 404);
  }

  return apiSuccess({ disconnected: true });
});
