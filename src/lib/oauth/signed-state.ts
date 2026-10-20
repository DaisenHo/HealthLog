/**
 * v1.17.0 — stateless, HMAC-signed OAuth `state` for the Polar + Oura
 * authorization-code flows.
 *
 * Unlike WHOOP / Withings (which carry the in-flight `(nonce → userId)` mapping
 * in a short-lived DB ledger row), the F4 providers store their tokens directly
 * on `User` and the merged schema ships NO `*OAuthState` table. The CSRF
 * defence therefore lives in the signed state itself: the `state` param is
 * `<provider>.<userId>.<expiryMs>.<nonce>` plus an HMAC-SHA256 tag over that
 * payload, keyed by `API_TOKEN_HMAC_KEY`. The same opaque token is also set as
 * an httpOnly cookie at connect time, so the callback enforces BOTH:
 *
 *   1. signature + expiry + provider binding are valid (the token wasn't forged
 *      or replayed past its TTL), AND
 *   2. the `state` URL param equals the cookie value byte-for-byte (double-
 *      submit — an attacker who can plant a `state` query param cannot also set
 *      our httpOnly cookie).
 *
 * The `userId` rides INSIDE the signed payload (tamper-evident), so the
 * callback resolves identity from the verified token rather than the ambient
 * session — the same property the WHOOP ledger row gives, without a table.
 *
 * Security notes:
 *   - The payload is signed, not encrypted. A `userId` (an opaque cuid) is not
 *     a secret, and it never leaves the user's own browser round-trip. The
 *     signature is what matters: a third party cannot mint a state for another
 *     user without the server HMAC key.
 *   - `verifySignedState` is fully constant-time on the tag compare and rejects
 *     a provider / expiry / shape mismatch BEFORE the (already constant-time)
 *     compare, so a malformed probe can't leak timing about the key.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Providers that share this signed-state machinery. */
export type OAuthStateProvider = "polar" | "oura" | "strava";

/** 10-minute TTL — long enough to approve a consent screen, short enough that
 * an abandoned handshake's token is useless within the hour. Mirrors the
 * WHOOP / Withings ledger-row TTL. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** httpOnly cookie name carrying the in-flight signed state, per provider. */
export function oauthStateCookieName(provider: OAuthStateProvider): string {
  return `${provider}_oauth_state`;
}

function getKey(): string {
  const key = process.env.API_TOKEN_HMAC_KEY;
  if (!key || key.length < 32) {
    throw new Error(
      "API_TOKEN_HMAC_KEY must be set (>=32 chars) to sign OAuth state",
    );
  }
  return key;
}

/** Field separator — `.` is base64url-safe-adjacent and absent from every
 * field (provider is a fixed literal, userId is a cuid, the rest are digits /
 * base64url), so the split is unambiguous. */
const SEP = ".";

function sign(payload: string): string {
  return createHmac("sha256", getKey()).update(payload).digest("base64url");
}

/**
 * Mint a signed state token for a user starting `provider`'s OAuth flow. The
 * returned string is used BOTH as the OAuth `state` URL param and as the
 * httpOnly cookie value.
 */
export function mintSignedState(
  provider: OAuthStateProvider,
  userId: string,
  now: number = Date.now(),
): string {
  const expiry = now + OAUTH_STATE_TTL_MS;
  const nonce = randomBytes(16).toString("base64url");
  const payload = [provider, userId, String(expiry), nonce].join(SEP);
  const tag = sign(payload);
  return `${payload}${SEP}${tag}`;
}

export interface VerifiedState {
  provider: OAuthStateProvider;
  userId: string;
  expiry: number;
}

/**
 * Verify a signed state token. Returns the decoded `{ provider, userId, expiry }`
 * only when the signature is valid, the provider matches, and the TTL has not
 * elapsed. Returns null on any failure — a forged tag, a wrong provider, an
 * expired token, or a malformed shape. Never throws on bad input (only on a
 * missing server key, which is an operator misconfiguration).
 */
export function verifySignedState(
  provider: OAuthStateProvider,
  token: string | null | undefined,
  now: number = Date.now(),
): VerifiedState | null {
  if (!token || token.length > 512) return null;
  const parts = token.split(SEP);
  if (parts.length !== 5) return null;
  const [gotProvider, userId, expiryStr, nonce, tag] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (gotProvider !== provider) return null;
  if (!userId || !nonce || !tag) return null;

  const expiry = Number.parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry) || String(expiry) !== expiryStr) return null;

  const payload = [gotProvider, userId, expiryStr, nonce].join(SEP);
  const expected = sign(payload);
  // Constant-time compare; length guard first so timingSafeEqual never throws
  // on mismatched buffer sizes.
  if (
    tag.length !== expected.length ||
    !timingSafeEqual(Buffer.from(tag), Buffer.from(expected))
  ) {
    return null;
  }

  // Signature is valid; now enforce the TTL.
  if (expiry <= now) return null;

  return { provider, userId, expiry };
}

/**
 * Constant-time double-submit check: the `state` URL param must equal the
 * cookie value byte-for-byte. Both are the same minted token, so an attacker
 * who can inject a `state` query param cannot also set our httpOnly cookie.
 */
export function stateMatchesCookie(
  urlState: string | null | undefined,
  cookieState: string | null | undefined,
): boolean {
  if (!urlState || !cookieState) return false;
  if (urlState.length !== cookieState.length) return false;
  return timingSafeEqual(Buffer.from(urlState), Buffer.from(cookieState));
}
