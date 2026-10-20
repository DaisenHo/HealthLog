import { apiHandler, requireAuth } from "@/lib/api-handler";
import { annotate } from "@/lib/logging/context";
import { shouldEmitSecureCookie } from "@/lib/auth/secure-cookie";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAuthorizationUrl } from "@/lib/oura/client";
import { getOuraClientCredentials } from "@/lib/oura/credentials";
import {
  OAUTH_STATE_TTL_MS,
  mintSignedState,
  oauthStateCookieName,
} from "@/lib/oauth/signed-state";
import { NextResponse } from "next/server";

/**
 * v1.17.0 — redirect the user to the Oura consent screen.
 *
 * Credentials resolve DB-first then env (`getOuraClientCredentials`): a user's
 * BYO Oura client id/secret wins, falling back to the shared env app
 * (`OURA_CLIENT_ID` / `OURA_CLIENT_SECRET`) when none is stored. CSRF via the
 * stateless signed state (`src/lib/oauth/signed-state.ts`): the same token is
 * the `state` URL param AND an httpOnly cookie. Rate-limited per user. The
 * no-credentials branch redirects too (v1.29.x) rather than returning a raw
 * JSON 400 — every other failure path here already redirects, and a
 * browser-navigation entry point should never surface an unstyled JSON page.
 */
const CONNECT_RATE_LIMIT = 10;
const CONNECT_WINDOW_MS = 60_000;

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "oura.connect" } });

  const rl = await checkRateLimit(
    `oura:connect:${user.id}`,
    CONNECT_RATE_LIMIT,
    CONNECT_WINDOW_MS,
  );
  if (!rl.allowed) {
    annotate({ action: { name: "oura.connect.rate_limited" } });
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?oura=error&reason=rate_limited",
        process.env.NEXT_PUBLIC_APP_URL!,
      ),
    );
  }

  const creds = await getOuraClientCredentials(user.id);
  if (!creds) {
    annotate({ action: { name: "oura.connect.no_credentials" } });
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?oura=error&reason=nocreds",
        process.env.NEXT_PUBLIC_APP_URL!,
      ),
    );
  }

  const state = mintSignedState("oura", user.id);
  const url = getAuthorizationUrl(state, creds);

  const response = NextResponse.redirect(url);
  response.cookies.set(oauthStateCookieName("oura"), state, {
    httpOnly: true,
    secure: shouldEmitSecureCookie(),
    sameSite: "lax",
    maxAge: Math.floor(OAUTH_STATE_TTL_MS / 1000),
    path: "/",
  });
  return response;
});
