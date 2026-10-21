/**
 * v1.28.x — off-response classifier for Strava API v3 replies.
 * HTTP-status-driven; the shared core lives in
 * `src/lib/integrations/http-status-classifier.ts` and is re-exported here
 * under the Strava-specific names callers already use.
 *
 *   - `success`         → HTTP 2xx
 *   - `transient`       → 429 (rate-limited — respect X-RateLimit headers),
 *                         5xx, 3xx, unknown.
 *   - `reauth_required` → 401 / 403 — token rejected / grant revoked, plus an
 *                         `invalid_grant` on the refresh endpoint.
 *   - `persistent`      → any other 4xx — malformed request / contract drift.
 */

import {
  classifyHttpStatus,
  classifyIntegrationError,
  IntegrationApiError,
  isOAuthInvalidGrant,
  type ClassifiedHttpResponse,
  type IntegrationClassification,
} from "@/lib/integrations/http-status-classifier";

export function classifyStravaResponse(
  httpStatus: number,
): ClassifiedHttpResponse {
  return classifyHttpStatus(httpStatus);
}

export class StravaApiError extends IntegrationApiError {
  /**
   * On a 429: how long Strava's own headers say to wait before asking again
   * (`stravaRateLimitRetryAfterSeconds`). Undefined on every other failure.
   */
  readonly retryAfterSeconds: number | undefined;

  constructor(opts: {
    verb: string;
    classification: IntegrationClassification;
    httpStatus: number | undefined;
    reason: string;
    upstreamError?: string;
    retryAfterSeconds?: number;
  }) {
    const { retryAfterSeconds, ...rest } = opts;
    super({ vendor: "Strava", ...rest });
    this.name = "StravaApiError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** True for Strava's rate-limit refusal. */
export function isStravaRateLimited(err: unknown): err is StravaApiError {
  return err instanceof StravaApiError && err.httpStatus === 429;
}

/**
 * True when a caught error is an OAuth `invalid_grant` on the token endpoint —
 * the canonical revoked / rotated-away refresh-token signal. Lifts a 400
 * carrying `invalid_grant` from `persistent` to `reauth_required` so the
 * connection surfaces the reconnect prompt.
 */
function isInvalidGrant(err: unknown): boolean {
  return isOAuthInvalidGrant(err, "Strava");
}

export function classifyStravaError(err: unknown): IntegrationClassification {
  if (isInvalidGrant(err)) return "reauth_required";
  return classifyIntegrationError(err, "Strava");
}
