/**
 * Ending an OAuth connection: tell the provider where it listens, drop the
 * grant, audit it, and park the integration at `disconnected`. One
 * implementation for the person's own disconnect (`POST
 * /api/<provider>/disconnect`) and a guardian's for a managed profile
 * (`POST /api/record-settings/integrations/<provider>/disconnect`). Imported
 * data stays; a reconnect resumes the sync.
 *
 * The audit row is filed under the record; when a guardian acts, `auditLog`
 * reads the guardian off the request and records them as the actor.
 */
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { auditLog } from "@/lib/auth/audit";
import { decrypt } from "@/lib/crypto";
import { getEvent } from "@/lib/logging/context";
import { markDisconnected } from "@/lib/integrations/status";
import { unsubscribeWebhook } from "@/lib/withings/client";
import {
  WITHINGS_NOTIFY_APPLIS,
  getWithingsWebhookCallbackUrl,
} from "@/lib/withings/sync";
import { deauthorize } from "@/lib/strava/client";
import {
  STRAVA_DISCONNECTED,
  getStravaConnection,
} from "@/lib/strava/credentials";
import type { OAuthKitProvider } from "./token";

export type DisconnectOutcome = "disconnected" | "not_connected";

/** The audit action each provider has always filed a disconnect under. */
const AUDIT_ACTION: Record<OAuthKitProvider, string> = {
  withings: "withings.disconnect",
  whoop: "whoop.disconnect",
  "google-health": "google_health.disconnect",
  oura: "oura.disconnect",
  polar: "polar.disconnect",
  strava: "strava.disconnect",
};

async function dropGrant(
  provider: OAuthKitProvider,
  userId: string,
): Promise<boolean> {
  switch (provider) {
    case "withings": {
      const connection = await prisma.withingsConnection.findUnique({
        where: { userId },
      });
      if (!connection) return false;
      // Withings keeps calling a subscribed URL after the grant is gone, so
      // the subscriptions go first. Best effort: a refused unsubscribe must
      // not keep the person connected.
      try {
        const accessToken = decrypt(connection.accessToken);
        const callbackUrl = getWithingsWebhookCallbackUrl();
        for (const appli of WITHINGS_NOTIFY_APPLIS) {
          try {
            await unsubscribeWebhook(accessToken, callbackUrl, appli);
          } catch {
            // Already gone, or the token expired; the delete below stands.
          }
        }
      } catch {
        // An undecryptable token cannot unsubscribe anything.
      }
      await prisma.withingsConnection.delete({ where: { userId } });
      return true;
    }
    case "whoop": {
      const connection = await prisma.whoopConnection.findUnique({
        where: { userId },
      });
      if (!connection) return false;
      await prisma.whoopConnection.delete({ where: { userId } });
      return true;
    }
    case "google-health": {
      const connection = await prisma.googleHealthConnection.findUnique({
        where: { userId },
      });
      if (!connection) return false;
      await prisma.googleHealthConnection.delete({ where: { userId } });
      return true;
    }
    case "oura": {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { ouraAccessTokenEncrypted: true },
      });
      if (!row?.ouraAccessTokenEncrypted) return false;
      await prisma.user.update({
        where: { id: userId },
        data: {
          ouraAccessTokenEncrypted: null,
          ouraRefreshTokenEncrypted: null,
          ouraScopeDenied: Prisma.DbNull,
        },
      });
      return true;
    }
    case "polar": {
      const row = await prisma.user.findUnique({
        where: { id: userId },
        select: { polarAccessTokenEncrypted: true },
      });
      if (!row?.polarAccessTokenEncrypted) return false;
      await prisma.user.update({
        where: { id: userId },
        data: { polarAccessTokenEncrypted: null, polarUserIdEncrypted: null },
      });
      return true;
    }
    case "strava": {
      const connection = await getStravaConnection(userId);
      if (!connection) return false;
      // Strava keeps the app authorised until it is told otherwise.
      try {
        await deauthorize(connection.accessToken);
      } catch (err) {
        getEvent()?.addWarning(
          `strava: deauthorize failed on disconnect: ${err}`,
        );
      }
      await prisma.user.update({
        where: { id: userId },
        data: STRAVA_DISCONNECTED,
      });
      return true;
    }
  }
}

/** Disconnect `provider` from the record `userId`. */
export async function disconnectOAuth(
  provider: OAuthKitProvider,
  userId: string,
): Promise<DisconnectOutcome> {
  if (!(await dropGrant(provider, userId))) return "not_connected";
  await auditLog(AUDIT_ACTION[provider], { userId });
  await markDisconnected(userId, provider);
  return "disconnected";
}
