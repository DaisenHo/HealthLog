import { apiHandler, requireAuth } from "@/lib/api-handler";
import {
  setConnectStateCookie,
  startOAuthConnect,
} from "@/lib/integrations/oauth-kit/connect-start";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

/**
 * v1.17.0 — redirect the user to the Polar AccessLink consent screen.
 *
 * BYO-key OAuth: the client id/secret resolve DB-first then env via
 * `getPolarClientCredentials` — a user's own AccessLink app when stored,
 * otherwise the shared `POLAR_CLIENT_ID` / `POLAR_CLIENT_SECRET`. The CSRF
 * defence is a stateless signed state (`src/lib/oauth/signed-state.ts`): the
 * same token is the `state` URL param AND an httpOnly cookie, and the callback
 * enforces both signature validity and a byte-exact cookie match.
 *
 * Rate-limited per user so a session can't spam the consent redirect. The
 * no-credentials branch redirects too (v1.29.x) rather than returning a raw
 * JSON 400 — every other failure path here already redirects, and a
 * browser-navigation entry point should never surface an unstyled JSON page.
 */
const CONNECT_RATE_LIMIT = 10;
const CONNECT_WINDOW_MS = 60_000;

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "polar.connect" } });

  const rl = await checkRateLimit(
    `polar:connect:${user.id}`,
    CONNECT_RATE_LIMIT,
    CONNECT_WINDOW_MS,
  );
  if (!rl.allowed) {
    annotate({ action: { name: "polar.connect.rate_limited" } });
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?polar=error&reason=rate_limited",
        process.env.NEXT_PUBLIC_APP_URL!,
      ),
    );
  }

  const started = await startOAuthConnect("polar", user.id);
  if (!started.ok) {
    annotate({ action: { name: "polar.connect.no_credentials" } });
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?polar=error&reason=nocreds",
        process.env.NEXT_PUBLIC_APP_URL!,
      ),
    );
  }

  return setConnectStateCookie(
    NextResponse.redirect(started.authorizationUrl),
    started.cookie,
  );
});
