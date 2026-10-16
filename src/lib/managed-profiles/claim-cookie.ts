/**
 * v1.43 (#959) — the sealed cookie that carries a single-sign-on claim through
 * the round trip to the identity provider.
 *
 * `POST /api/auth/claim/sso` checks the handover token and the chosen username
 * and seals `{ handoverId, username, binding, exp }` into `hl_claim`. The
 * token itself never leaves that request: the cookie names the link by its
 * id, and it can only have been minted by a request that held the token.
 *
 *   - AES-256-GCM with the at-rest key (`encrypt`), so it can be neither read
 *     nor forged, and it carries its own expiry on top of `Max-Age`.
 *   - `HttpOnly`, `SameSite=Lax` (the browser returns from the provider on a
 *     cross-site top-level GET and must carry it), `Secure` through
 *     `shouldEmitSecureCookie()`.
 *   - Scoped to `/api/auth/oidc`, the only two routes that read it.
 *   - `binding` is a fresh random value per start. The login copies it into
 *     the encrypted OIDC state, and the callback admits the claim only when
 *     the cookie and the state carry the same one, so a claim cookie from a
 *     different start (another tab, an older attempt) cannot be paired with
 *     this sign-in.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

import { decrypt, encrypt } from "@/lib/crypto";
import { shouldEmitSecureCookie } from "@/lib/auth/secure-cookie";

export const CLAIM_COOKIE = "hl_claim";
export const CLAIM_COOKIE_PATH = "/api/auth/oidc";
export const CLAIM_COOKIE_TTL_MS = 10 * 60 * 1000;

/**
 * Where `POST /api/auth/claim/sso` sends the browser next. A fixed path:
 * nothing caller-supplied ever reaches a redirect on this flow.
 */
export const CLAIM_SSO_REDIRECT = "/api/auth/oidc/login?intent=claim";

/** Where every refusal on the single-sign-on claim lands, with `?error=`. */
export const CLAIM_ERROR_PATH = "/auth/claim";

export interface PendingSsoClaim {
  handoverId: string;
  username: string;
  binding: string;
}

/** Attach a freshly sealed claim to a response. Returns what was sealed. */
export function setClaimCookie(
  response: NextResponse,
  claim: { handoverId: string; username: string },
  now: number = Date.now(),
): PendingSsoClaim {
  const binding = randomBytes(32).toString("base64url");
  const sealed = encrypt(
    JSON.stringify({
      h: claim.handoverId,
      u: claim.username,
      b: binding,
      e: now + CLAIM_COOKIE_TTL_MS,
    }),
  );
  response.cookies.set(CLAIM_COOKIE, sealed, {
    httpOnly: true,
    secure: shouldEmitSecureCookie(),
    sameSite: "lax",
    maxAge: Math.floor(CLAIM_COOKIE_TTL_MS / 1000),
    path: CLAIM_COOKIE_PATH,
  });
  return { ...claim, binding };
}

/** The claim a cookie value carries, or null when absent, forged or expired. */
export function readClaimCookie(
  raw: string | undefined,
  now: number = Date.now(),
): PendingSsoClaim | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decrypt(raw)) as Record<string, unknown>;
    if (
      typeof parsed.h !== "string" ||
      parsed.h.length === 0 ||
      typeof parsed.u !== "string" ||
      parsed.u.length === 0 ||
      typeof parsed.b !== "string" ||
      parsed.b.length === 0 ||
      typeof parsed.e !== "number" ||
      parsed.e <= now
    ) {
      return null;
    }
    return { handoverId: parsed.h, username: parsed.u, binding: parsed.b };
  } catch {
    return null;
  }
}

/** Whether a claim belongs to the sign-in whose state carries `binding`. */
export function claimMatchesBinding(
  claim: PendingSsoClaim,
  binding: string,
): boolean {
  const a = Buffer.from(claim.binding);
  const b = Buffer.from(binding);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Expire the claim cookie on a response; the path must repeat the set's. */
export function clearClaimCookie(response: NextResponse): void {
  response.cookies.delete({ name: CLAIM_COOKIE, path: CLAIM_COOKIE_PATH });
}
