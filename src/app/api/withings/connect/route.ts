import { apiHandler, requireAuth } from "@/lib/api-handler";
import {
  setConnectStateCookie,
  startOAuthConnect,
} from "@/lib/integrations/oauth-kit/connect-start";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextRequest, NextResponse } from "next/server";
import { relativeRedirect } from "@/lib/http/relative-redirect";

/**
 * Redirects the user to Withings OAuth authorization page.
 *
 * v1.4.47 — state is now a fully-random 22-character base64url
 * nonce backed by a 10-minute `WithingsOAuthState` row, rather than
 * the legacy `${user.id}:${random16}` shape. The cookie carries JUST
 * the nonce (no user id), the OAuth state URL param carries JUST the
 * nonce, and the callback resolves the user via the row's `userId`
 * column. Closes the v1.4.43 security audit L-1 finding where the
 * user id was recoverable from log entries / network captures.
 *
 * v1.4.48 — endpoint is now rate-limited per-user (10 calls
 * per 60 s) so a logged-in user with valid creds can't spam ledger
 * rows for the full 10-min TTL window. The row-create call is wrapped
 * in try/catch; a transient DB glitch now lands on the existing
 * `/settings/integrations?withings=error&reason=connect` surface
 * instead of bubbling a 500. Both rate-limit and create-failure paths
 * redirect rather than returning JSON because the entry point is a
 * browser navigation — a 429 envelope would surface as a blank page.
 *
 * v1.29.x — the no-credentials branch redirects too, matching every
 * other failure path in this route. It used to return a raw JSON 400,
 * which every browser navigation into this route (onboarding's
 * "Connect Withings" tap included) surfaced as an unstyled JSON page —
 * the first "connect a device" moment for a brand-new self-hoster.
 */

const CONNECT_RATE_LIMIT = 10;
const CONNECT_WINDOW_MS = 60_000;

export const GET = apiHandler(async (req: NextRequest) => {
  const { user } = await requireAuth();
  annotate({ action: { name: "withings.connect" } });

  const rl = await checkRateLimit(
    `withings:connect:${user.id}`,
    CONNECT_RATE_LIMIT,
    CONNECT_WINDOW_MS,
  );
  if (!rl.allowed) {
    annotate({ action: { name: "withings.connect.rate_limited" } });
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?withings=error&reason=rate_limited",
        req.url,
      ),
    );
  }

  const started = await startOAuthConnect("withings", user.id);
  if (!started.ok) {
    if (started.reason === "nocreds") {
      annotate({ action: { name: "withings.connect.no_credentials" } });
      return relativeRedirect(
        "/settings/integrations?withings=error&reason=nocreds",
      );
    }
    annotate({ action: { name: "withings.connect.create_failed" } });
    return relativeRedirect(
      "/settings/integrations?withings=error&reason=connect",
    );
  }

  return setConnectStateCookie(
    NextResponse.redirect(started.authorizationUrl),
    started.cookie,
  );
});
