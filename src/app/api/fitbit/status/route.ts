import { prisma } from "@/lib/db";
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { annotate } from "@/lib/logging/context";
import { apiSuccess } from "@/lib/api-response";
import { loadOneConnectionHealth } from "@/lib/integrations/connection-health-load";

/**
 * Get Fitbit / Google Health connection status for the current user (v1.12.0).
 *
 * Mirrors the WHOOP status route: `configured` checks the per-user BYO-key
 * credentials, the connection row reports last-sync + token expiry + backfill
 * progress. `tokenExpired` is reported straight off the row; the sync path
 * refreshes lazily via `getValidToken`.
 */
export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "fitbit.status" } });

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      fitbitClientIdEncrypted: true,
      fitbitClientSecretEncrypted: true,
    },
  });

  const configured =
    !!dbUser?.fitbitClientIdEncrypted && !!dbUser?.fitbitClientSecretEncrypted;

  const connection = await prisma.fitbitConnection.findUnique({
    where: { userId: user.id },
    select: {
      fitbitUserId: true,
      lastSyncedAt: true,
      tokenExpiresAt: true,
      backfillCompletedAt: true,
      createdAt: true,
      scope: true,
    },
  });

  if (!connection) {
    return apiSuccess({ connected: false, configured });
  }

  const tokenExpired = connection.tokenExpiresAt.getTime() <= Date.now();

  return apiSuccess({
    connected: true,
    configured,
    lastSyncedAt: connection.lastSyncedAt,
    connectedAt: connection.createdAt,
    tokenExpired,
    tokenExpiresAt: connection.tokenExpiresAt,
    backfillCompleted: !!connection.backfillCompletedAt,
    scope: connection.scope,
    // The one server-resolved state (ok / limited / degraded /
    // action_required) every client renders. The fields above stay for
    // clients that still read them; see `ConnectionHealth` in the API docs.
    health: await loadOneConnectionHealth(user.id, "fitbit"),
  });
});
