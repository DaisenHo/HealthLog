import { prisma } from "@/lib/db";
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { annotate, getEvent } from "@/lib/logging/context";
import { apiSuccess } from "@/lib/api-response";
import { loadOneConnectionHealth } from "@/lib/integrations/connection-health-load";
import { decrypt, encrypt } from "@/lib/crypto";
import { getUserWithingsCredentials } from "@/lib/withings/credentials";
import { hasActivityScope, refreshAccessToken } from "@/lib/withings/client";
import { isWithingsRefreshReauthFailure } from "@/lib/withings/sync";
import { markReauthRequired } from "@/lib/integrations/status";

/**
 * Get Withings connection status for the current user.
 * "configured" now checks per-user credentials instead of env vars.
 */
export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "withings.status" } });

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      withingsClientIdEncrypted: true,
      withingsClientSecretEncrypted: true,
    },
  });

  const configured =
    !!dbUser?.withingsClientIdEncrypted &&
    !!dbUser?.withingsClientSecretEncrypted;

  const connection = await prisma.withingsConnection.findUnique({
    where: { userId: user.id },
    select: {
      withingsUserId: true,
      accessToken: true,
      refreshToken: true,
      lastSyncedAt: true,
      tokenExpiresAt: true,
      createdAt: true,
      scope: true,
    },
  });

  if (!connection) {
    return apiSuccess({ connected: false, configured });
  }

  let tokenExpiresAt = connection.tokenExpiresAt;
  const now = Date.now();
  let tokenExpired = tokenExpiresAt.getTime() <= now;
  let tokenRefreshFailed = false;

  // Keep status reliable: if token is expired (or about to expire), refresh it
  // before reporting "abgelaufen" in the UI.
  const shouldRefresh = tokenExpiresAt.getTime() - 60_000 <= now;
  if (shouldRefresh) {
    try {
      const creds = await getUserWithingsCredentials(user.id);
      if (creds) {
        const refreshToken = decrypt(connection.refreshToken);
        const refreshed = await refreshAccessToken(refreshToken, creds);
        tokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);
        tokenExpired = tokenExpiresAt.getTime() <= Date.now();

        await prisma.withingsConnection.update({
          where: { userId: user.id },
          data: {
            accessToken: encrypt(refreshed.access_token),
            refreshToken: encrypt(refreshed.refresh_token),
            tokenExpiresAt,
          },
        });
      } else if (tokenExpired) {
        tokenRefreshFailed = true;
      }
    } catch (error) {
      if (tokenExpired) {
        tokenRefreshFailed = true;
      }
      getEvent()?.addWarning("Token refresh failed");
      // A permanently revoked grant should park the integration until
      // the user reconnects. We mirror the same status-code parsing
      // the sync path does.
      const message = error instanceof Error ? error.message : String(error);
      if (isWithingsRefreshReauthFailure(message)) {
        // Awaited so the persisted re-auth state is reflected in this same
        // status response — but a persistence failure must not fail the read.
        // Breadcrumb it instead of swallowing silently (the message rides the
        // central annotate/redact path, never the raw console).
        await markReauthRequired(user.id, "withings", message).catch(
          (error: unknown) => {
            annotate({
              meta: {
                "fire_and_forget.integration.reauth.mark": {
                  error: error instanceof Error ? error.message : String(error),
                  provider: "withings",
                },
              },
            });
          },
        );
      }
    }
  }

  return apiSuccess({
    connected: true,
    configured,
    lastSyncedAt: connection.lastSyncedAt,
    connectedAt: connection.createdAt,
    tokenExpired,
    tokenRefreshFailed,
    tokenExpiresAt,
    // v1.4.25 — `scope` is the comma-separated OAuth scope string
    // returned during the auth flow; `hasActivityScope` is the
    // pre-computed convenience flag the Settings reconnect banner
    // reads. Null `scope` means a legacy v1.4.24 connection that's
    // never re-authed since v1.4.25 — it counts as "missing activity".
    scope: connection.scope,
    hasActivityScope: hasActivityScope(connection.scope),
    // The one server-resolved state (ok / limited / degraded /
    // action_required) every client renders. The fields above stay for
    // clients that still read them; see `ConnectionHealth` in the API docs.
    health: await loadOneConnectionHealth(user.id, "withings"),
  });
});
