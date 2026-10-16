/**
 * Which Dawarich instances HealthLog may call.
 *
 * Dawarich is self-hosted, and most instances live on the operator's own
 * network. The rule is the Nightscout one: a public host is reachable without
 * configuration, a private one only when its exact origin is listed in
 * `DAWARICH_PRIVATE_ORIGINS` (the shared grant grammar in
 * `@/lib/private-origin-policy`: one `scheme://host[:port]` per entry, comma
 * separated, never a suffix or a range). The request body can never widen it.
 *
 * Unlike a Nightscout address, a Dawarich base URL may carry a path (an
 * instance served under a sub-path behind a reverse proxy). The grant is
 * matched on the origin; the path is kept as the base the API paths hang off.
 */
import {
  evaluateOriginGrant,
  INVALID_ORIGIN,
  originOfUrl,
  parsePrivateOrigins,
  type OriginReason,
} from "@/lib/private-origin-policy";

/**
 * `DAWARICH_PRIVATE_ORIGINS` holds an entry that is not a grant. The message
 * names the entry (scheme and host only) and why, so the connect form shows
 * the operator what to edit.
 */
export class DawarichOriginConfigError extends Error {
  constructor(redactedEntry: string, reason: string) {
    super(
      `Invalid DAWARICH_PRIVATE_ORIGINS entry "${redactedEntry}": ${reason}`,
    );
    this.name = "DawarichOriginConfigError";
  }
}

/** The operator's exact-origin grants; throws on a malformed entry. */
export function configuredDawarichPrivateOrigins(): ReadonlySet<string> {
  return parsePrivateOrigins(
    process.env.DAWARICH_PRIVATE_ORIGINS,
    (redactedEntry, reason) => {
      throw new DawarichOriginConfigError(redactedEntry, reason);
    },
  );
}

export interface DawarichTarget {
  allowed: boolean;
  /** The base URL without a trailing slash, null when the input is not a usable URL. */
  baseUrl: string | null;
  /** The canonical origin of `baseUrl`; the value the private grant is matched on. */
  origin: string | null;
  privateOriginApproved: boolean;
  reasonCode: OriginReason | null;
}

/**
 * Resolve a user-supplied Dawarich base URL against the operator's grants.
 * Credentials, a query and a fragment make the URL unusable (`invalid_origin`):
 * the API key travels in a header, never in the address.
 */
export function evaluateDawarichUrl(
  value: string,
  privateOrigins: ReadonlySet<string>,
): DawarichTarget {
  const refused = (reasonCode: OriginReason): DawarichTarget => ({
    allowed: false,
    baseUrl: null,
    origin: null,
    privateOriginApproved: false,
    reasonCode,
  });
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refused(INVALID_ORIGIN);
  }
  if (url.username || url.password || url.search || url.hash) {
    return refused(INVALID_ORIGIN);
  }
  const origin = originOfUrl(value);
  if (!origin) return refused(INVALID_ORIGIN);
  const verdict = evaluateOriginGrant(origin, privateOrigins, value);
  const path = url.pathname.replace(/\/+$/, "");
  return {
    allowed: verdict.allowed,
    baseUrl: verdict.allowed ? `${origin}${path}` : null,
    origin,
    privateOriginApproved: verdict.privateOriginApproved,
    reasonCode: verdict.reasonCode,
  };
}
