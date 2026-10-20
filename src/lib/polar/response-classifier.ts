/**
 * v1.17.0 — off-response classifier for Polar AccessLink replies.
 *
 * Polar signals failure through the HTTP status code, so the classification is
 * status-driven. The shared core lives in
 * `src/lib/integrations/http-status-classifier.ts`; this module re-exports it
 * under the Polar-specific names callers already use.
 *
 *   - `success`         → HTTP 2xx (incl. 204 No Content — Polar returns 204
 *                         when a collection window holds no records).
 *   - `transient`       → retryable: 429 (rate-limited), 5xx upstream, 3xx
 *                         CDN glitch, and an unknown status.
 *   - `reauth_required` → 401 / 403 — the access token is rejected or the user
 *                         revoked the grant; the user must reconnect.
 *   - `persistent`      → any other 4xx — a malformed request / contract
 *                         mismatch that a retry won't fix.
 */

import {
  classifyHttpStatus,
  classifyIntegrationError,
  IntegrationApiError,
  isOAuthInvalidGrant,
  type ClassifiedHttpResponse,
  type IntegrationClassification,
} from "@/lib/integrations/http-status-classifier";

export type PolarClassification = IntegrationClassification;

export type ClassifiedPolarResponse = ClassifiedHttpResponse;

export function classifyPolarResponse(
  httpStatus: number,
): ClassifiedPolarResponse {
  return classifyHttpStatus(httpStatus);
}

/** Typed error carrying the classification verdict. Extends the shared base. */
export class PolarApiError extends IntegrationApiError {
  constructor(opts: {
    verb: string;
    classification: PolarClassification;
    httpStatus: number | undefined;
    reason: string;
    upstreamError?: string;
  }) {
    super({ vendor: "Polar", ...opts });
    this.name = "PolarApiError";
  }
}

/**
 * True when a caught error is an OAuth `invalid_grant` on the token endpoint —
 * a stale/replayed authorization code on Polar's only token call
 * (`exchangeCode`). Lifts a 400 carrying `invalid_grant` from `persistent` to
 * `reauth_required` so the connection surfaces the reconnect prompt instead of
 * silently parking after 24 h.
 */
export function isInvalidGrant(err: unknown): boolean {
  return isOAuthInvalidGrant(err, "Polar");
}

/**
 * Read the classification from any caught error. A non-`PolarApiError` defaults
 * to `transient` so a plain `Error` retries rather than disabling the
 * integration. Falls back to parsing the status out of the message shape for a
 * caller that lost the prototype across a pg-boss retry.
 */
export function classifyPolarError(err: unknown): PolarClassification {
  if (isInvalidGrant(err)) return "reauth_required";
  return classifyIntegrationError(err, "Polar");
}
