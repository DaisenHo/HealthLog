import type { NextRequest } from "next/server";

import {
  apiHandler,
  requireGuardianAuth,
  SharingAccessDeniedError,
} from "@/lib/api-handler";
import { apiError, apiSuccess } from "@/lib/api-response";
import { auditLog } from "@/lib/auth/audit";
import {
  recordHasClientApp,
  setConnectStateCookie,
  startOAuthConnect,
} from "@/lib/integrations/oauth-kit/connect-start";
import { shareGuardianClientApp } from "@/lib/integrations/oauth-kit/connect-target";
import { isManagedOAuthProvider } from "@/lib/integrations/oauth-kit/managed-provider";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { resolveGuardianRecordSettingsAccess } from "@/lib/record-settings";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ provider: string }> };

const CONNECT_RATE_LIMIT = 10;
const CONNECT_WINDOW_MS = 60_000;

/**
 * A guardian starts connecting a provider for the managed profile they are
 * acting on.
 *
 * A fetch, not a navigation: the record-session fence needs the headers the
 * app transport sends, which a browser navigation cannot carry. So this
 * answers with the consent URL and sets the state cookie, and the page then
 * sends the browser to the provider. The state names the profile; the
 * provider's callback lands the tokens there after checking the browser is
 * still a guardian of it (`verifyCallbackActor`).
 *
 * Without a provider app of its own, the profile borrows the guardian's.
 */
export const POST = apiHandler(
  async (_request: NextRequest, { params }: RouteParams) => {
    const { provider } = await params;
    if (!isManagedOAuthProvider(provider)) {
      return apiError("Integration not found", 404);
    }

    const context = await requireGuardianAuth();
    const access = resolveGuardianRecordSettingsAccess(context);
    if (!access) throw new SharingAccessDeniedError();
    annotate({
      action: { name: "record-settings.integration.connect.start" },
      meta: { provider },
    });

    const rl = await checkRateLimit(
      `${provider}:connect:${access.recordId}`,
      CONNECT_RATE_LIMIT,
      CONNECT_WINDOW_MS,
    );
    if (!rl.allowed) {
      return apiError("Too many requests", 429, {
        headers: rateLimitHeaders(rl),
      });
    }

    await shareGuardianClientApp(
      provider,
      { recordUserId: access.recordId, actorUserId: access.actorId },
      () => recordHasClientApp(provider, access.recordId),
    );

    const started = await startOAuthConnect(provider, access.recordId);
    if (!started.ok) {
      return started.reason === "nocreds"
        ? apiError(
            "Neither this profile nor your own account has an app for this provider.",
            409,
          )
        : apiError("The connect could not be started.", 500);
    }

    await auditLog("integration.connect.started", {
      userId: access.recordId,
      details: { provider },
    });

    return setConnectStateCookie(
      apiSuccess({
        recordId: access.recordId,
        provider,
        authorizationUrl: started.authorizationUrl,
      }),
      started.cookie,
    );
  },
);
