/**
 * v1.42 (#959) — the refusals the anonymous claim routes give before they look
 * at a token, in one place so the preview and the claims cannot disagree.
 *
 * Order matters and is the register route's order:
 *
 *   1. What this server cannot do at all. The password claim sets a password,
 *      so a single-sign-on-only instance refuses it outright; the
 *      single-sign-on claim (v1.43) needs an identity provider, and answers
 *      404 `profile_claim.sso_unavailable` without one. The preview is
 *      refused by neither: it is what tells the page which way is open.
 *   2. A signed-in caller is refused with 409. Claiming creates a session for
 *      the new owner, and a Guardian testing their own link would otherwise be
 *      signed out of their account and into the person's. Refused before the
 *      rate limit: it is a state, not an attempt, and spending the bucket on it
 *      would lock out the person the link is for, who may share the address.
 *   3. The per-address rate limit, the anonymous auth-surface pattern: a
 *      misconfigured proxy trust chain collapses every caller into one tight
 *      bucket rather than one free-for-all. Both claims share one bucket, so
 *      switching between them buys no extra attempts.
 */
import { NextResponse } from "next/server";

import { apiError } from "@/lib/api-response";
import { getOidcConfig, isOidcConfigured, isOidcOnly } from "@/lib/auth/oidc";
import type { HandoverMethod } from "@/lib/validations/claim-sso";
import { annotate } from "@/lib/logging/context";
import { checkAuthSurfaceRateLimit, rateLimitHeaders } from "@/lib/rate-limit";

/** The one answer for every unusable link. Not an oracle. */
export function claimInvalid() {
  return apiError("This link is invalid, expired or already used", 404, {
    errorCode: "profile_claim.invalid",
  });
}

/**
 * v1.43 (#959) — how a handover link can be redeemed on this server: with a
 * password unless the server allows single sign-on only, and through the
 * identity provider whenever one is configured. Never empty in practice
 * (`OIDC_ONLY` only takes effect with a configured provider), but the Guardian
 * side refuses on an empty list rather than assuming it.
 */
export function handoverMethods(): HandoverMethod[] {
  const methods: HandoverMethod[] = [];
  if (!isOidcOnly()) methods.push("password");
  if (isOidcConfigured()) methods.push("sso");
  return methods;
}

/** The provider's name for the "Continue with …" button, or null. */
export function ssoProviderName(): string | null {
  return getOidcConfig()?.buttonLabel ?? null;
}

export async function claimGate(
  request: Request,
  surface: "preview" | "claim" | "sso",
  /**
   * Whether the request carries a live session. Resolved by the ROUTE with
   * `getSession()` and handed in, rather than resolved here: a session read
   * inside a `lib/` wrapper would take both routes off the direct
   * session-resolution list in `session-surface-guard.test.ts`, which is
   * exactly the disappearance that guard exists to catch.
   */
  signedIn: boolean,
): Promise<{ refusal: Response } | { refusal: null; ip: string | null }> {
  if (surface === "claim" && isOidcOnly()) {
    return {
      refusal: apiError(
        "This server allows single sign-on only; take the profile over through the identity provider",
        403,
        { errorCode: "profile_claim.oidc_only_unsupported" },
      ),
    };
  }
  if (surface === "sso" && !isOidcConfigured()) {
    return {
      refusal: apiError(
        "Single sign-on is not configured on this server",
        404,
        { errorCode: "profile_claim.sso_unavailable" },
      ),
    };
  }

  if (signedIn) {
    annotate({
      action: { name: `profile_claim.${surface}.refused_authenticated` },
    });
    return {
      refusal: apiError("Already signed in — sign out first", 409, {
        errorCode: "auth.already_authenticated",
      }),
    };
  }

  const rl =
    surface === "preview"
      ? await checkAuthSurfaceRateLimit(
          request,
          "auth:claim-preview",
          20,
          15 * 60 * 1000,
        )
      : await checkAuthSurfaceRateLimit(
          request,
          "auth:claim",
          5,
          15 * 60 * 1000,
        );
  if (!rl.allowed) {
    return {
      refusal: NextResponse.json(
        { data: null, error: "Too many attempts. Please try again later." },
        { status: 429, headers: rateLimitHeaders(rl) },
      ),
    };
  }
  return { refusal: null, ip: rl.ip };
}
