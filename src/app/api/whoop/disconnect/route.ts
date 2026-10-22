import { apiHandler, requireAuth } from "@/lib/api-handler";
import { disconnectOAuth } from "@/lib/integrations/oauth-kit/disconnect";
import { apiSuccess, apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";

/**
 * Disconnect the WHOOP integration for the current user (v1.11.0).
 *
 * Clears the stored OAuth tokens by deleting the `WhoopConnection` row and
 * parks the integration status at `disconnected`. WHOOP webhook subscriptions
 * are app-level (registered once per dev app), so there is no per-user
 * unsubscribe call to make — unlike Withings, which subscribes per category.
 * The BYO-key credentials on `User` are left intact so a reconnect doesn't
 * force the user to re-paste them; use the credentials DELETE endpoint to
 * remove those too.
 */
export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "whoop.disconnect" } });

  if ((await disconnectOAuth("whoop", user.id)) === "not_connected") {
    return apiError("No WHOOP connection", 404);
  }

  return apiSuccess({ disconnected: true });
});
