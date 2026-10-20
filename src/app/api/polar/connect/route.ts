import { apiHandler, requireAuth } from "@/lib/api-handler";
import { annotate } from "@/lib/logging/context";
import { shouldEmitSecureCookie } from "@/lib/auth/secure-cookie";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAuthorizationUrl } from "@/lib/polar/client";
import { getPolarClientCredentials } from "@/lib/polar/credentials";
import {
  OAUTH_STATE_TTL_MS,
  mintSignedState,
  oauthStateCookieName,
} from "@/lib/oauth/signed-state";
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

  const creds = await getPolarClientCredentials(user.id);
  if (!creds) {
    annotate({ action: { name: "polar.connect.no_credentials" } });
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?polar=error&reason=nocreds",
        process.env.NEXT_PUBLIC_APP_URL!,
      ),
    );
  }

  const state = mintSignedState("polar", user.id);
  const url = getAuthorizationUrl(state, creds);

  const response = NextResponse.redirect(url);
  response.cookies.set(oauthStateCookieName("polar"), state, {
    httpOnly: true,
    secure: shouldEmitSecureCookie(),
    sameSite: "lax",
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    path: "/",
  });
  return response;
});
