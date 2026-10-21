import type { NextRequest } from "next/server";

import {
  apiHandler,
  requireGuardianAuth,
  SharingAccessDeniedError,
} from "@/lib/api-handler";
import { apiError, apiSuccess } from "@/lib/api-response";
import { disconnectOAuth } from "@/lib/integrations/oauth-kit/disconnect";
import { isManagedOAuthProvider } from "@/lib/integrations/oauth-kit/managed-provider";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { resolveGuardianRecordSettingsAccess } from "@/lib/record-settings";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ provider: string }> };

/**
 * A guardian disconnects a provider from the managed profile they are acting
 * on, through the same disconnect a person runs for their own account
 * (`disconnectOAuth`). The profile's imported data stays.
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
      action: { name: "record-settings.integration.disconnect" },
      meta: { provider },
    });

    const rl = await checkRateLimit(
      `${provider}-disconnect:${access.recordId}`,
      20,
      60_000,
    );
    if (!rl.allowed) {
      return apiError("Too many requests", 429, {
        headers: rateLimitHeaders(rl),
      });
    }

    if (
      (await disconnectOAuth(provider, access.recordId)) === "not_connected"
    ) {
      return apiError("No connection", 404);
    }
    return apiSuccess({
      recordId: access.recordId,
      provider,
      disconnected: true,
    });
  },
);
