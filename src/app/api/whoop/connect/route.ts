import { apiHandler, requireAuth } from "@/lib/api-handler";
import {
  setConnectStateCookie,
  startOAuthConnect,
} from "@/lib/integrations/oauth-kit/connect-start";
import { apiError } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { checkRateLimit } from "@/lib/rate-limit";
import { consumeWhoopConnectTicket } from "@/lib/whoop/connect-ticket";
import { validateReturnScheme } from "@/lib/whoop/return-scheme";
import { NextRequest, NextResponse } from "next/server";
import { relativeRedirect } from "@/lib/http/relative-redirect";

/**
 * Redirect the user to the WHOOP OAuth authorization page (v1.11.0; native
 * enhancements v1.12.2).
 *
 * Mirrors the Withings connect route: a fully-random base64url state nonce
 * backed by a 10-minute `WhoopOAuthState` ledger row carries the
 * `(nonce → userId)` mapping, so the user id never travels in the OAuth
 * `state` param (which can land in request logs / network captures). The
 * httpOnly + Secure cookie carries JUST the nonce; the callback resolves the
 * user via the row's `userId`.
 *
 * v1.12.2 — two native-client enhancements:
 *   - `?ticket=<opaque>` lets a purely Bearer-authenticated native client (no
 *     web-session cookie) start the handshake. The connect route resolves the
 *     user from a one-time, unconsumed/unexpired ticket IN LIEU of a cookie,
 *     consumes it, and proceeds exactly as the cookie path. Expired / consumed
 *     / invalid → typed 401. The ticket is minted via the Bearer
 *     `POST /api/whoop/connect/ticket` route.
 *   - `?return_scheme=<custom-scheme>` (validated against a strict allowlist)
 *     is stored on the state row so it survives the OAuth round-trip; the
 *     callback uses it to send its FINAL redirect to a native custom scheme.
 *
 * Rate-limited per user (10 calls / 60 s) so a logged-in session can't spam
 * ledger rows for the full 10-min TTL window. Both the rate-limit and
 * create-failure paths redirect (not JSON) because the cookie entry point is a
 * browser navigation — a 429 envelope would surface as a blank page. The
 * no-credentials branch redirects too (v1.29.x), matching Withings — only the
 * ticket-invalid branch stays a typed 401 JSON response, since that path is
 * consumed by a native client, not a browser navigation.
 */
const CONNECT_RATE_LIMIT = 10;
const CONNECT_WINDOW_MS = 60_000;

export const GET = apiHandler(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);
  const ticket = searchParams.get("ticket");

  // Resolve the in-flight user. The ticket path is for Bearer-only native
  // clients whose in-app web session carries no cookie; it must NOT call
  // requireAuth (which would 401 the cookieless session). The cookie path is
  // unchanged. The ticket is single-use + consumed atomically here.
  let userId: string;
  if (ticket) {
    annotate({ action: { name: "whoop.connect.ticket.consume" } });
    const resolved = await consumeWhoopConnectTicket(ticket);
    if (!resolved) {
      annotate({ action: { name: "whoop.connect.ticket.invalid" } });
      // Typed 401 — the in-app session surfaces this; the client re-mints.
      return apiError(
        "Connect ticket is invalid, expired, or already used.",
        401,
      );
    }
    userId = resolved.userId;
  } else {
    const { user } = await requireAuth();
    userId = user.id;
  }
  annotate({ action: { name: "whoop.connect" } });

  const rl = await checkRateLimit(
    `whoop:connect:${userId}`,
    CONNECT_RATE_LIMIT,
    CONNECT_WINDOW_MS,
  );
  if (!rl.allowed) {
    annotate({ action: { name: "whoop.connect.rate_limited" } });
    return NextResponse.redirect(
      new URL(
        "/settings/integrations?whoop=error&reason=rate_limited",
        req.url,
      ),
    );
  }

  // Validate the optional native return scheme against the strict allowlist.
  // An invalid/absent value resolves to null → the callback uses the web
  // redirect (never an arbitrary reflected scheme).
  const returnScheme = validateReturnScheme(searchParams.get("return_scheme"));

  const started = await startOAuthConnect("whoop", userId, { returnScheme });
  if (!started.ok) {
    if (started.reason === "nocreds") {
      annotate({ action: { name: "whoop.connect.no_credentials" } });
      return relativeRedirect(
        "/settings/integrations?whoop=error&reason=nocreds",
      );
    }
    annotate({ action: { name: "whoop.connect.create_failed" } });
    return relativeRedirect(
      "/settings/integrations?whoop=error&reason=connect",
    );
  }

  return setConnectStateCookie(
    NextResponse.redirect(started.authorizationUrl),
    started.cookie,
  );
});
