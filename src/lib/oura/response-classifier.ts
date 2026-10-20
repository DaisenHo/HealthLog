/**
 * v1.17.0 — off-response classifier for Oura Cloud API v2 replies.
 * HTTP-status-driven; the shared core lives in
 * `src/lib/integrations/http-status-classifier.ts` and is re-exported here
 * under the Oura-specific names callers already use.
 *
 *   - `success`         → HTTP 2xx
 *   - `transient`       → 429 (rate-limited), 5xx, 3xx, unknown.
 *   - `reauth_required` → 401 / 403 — token rejected / grant revoked.
 *   - `persistent`      → any other 4xx — malformed request / contract drift.
 *
 * A collection read refines this from the body (`collectionRefusal` in
 * `./client`): a 401 that names a scope is a missing permission, a 403 a lapsed
 * membership.
 */

import {
  classifyHttpStatus,
  classifyIntegrationError,
  IntegrationApiError,
  isOAuthInvalidGrant,
  type ClassifiedHttpResponse,
  type IntegrationClassification,
} from "@/lib/integrations/http-status-classifier";

export function classifyOuraResponse(
  httpStatus: number,
): ClassifiedHttpResponse {
  return classifyHttpStatus(httpStatus);
}

export class OuraApiError extends IntegrationApiError {
  /**
   * The scope Oura named when it refused a collection read for a missing
   * permission (`401 {"detail":"Token is not authorized access stress
   * scope."}`). Undefined for every other failure, a dead token included.
   */
  readonly missingScope: string | undefined;

  constructor(opts: {
    verb: string;
    classification: IntegrationClassification;
    httpStatus: number | undefined;
    reason: string;
    upstreamError?: string;
    missingScope?: string;
  }) {
    const { missingScope, ...rest } = opts;
    super({
      vendor: "Oura",
      ...rest,
      upstreamError:
        rest.upstreamError ??
        (missingScope ? `scope_missing:${missingScope}` : undefined),
    });
    this.name = "OuraApiError";
    this.missingScope = missingScope;
  }
}

/**
 * True when a caught error is an OAuth `invalid_grant` on the token endpoint —
 * the canonical revoked-refresh-token signal. Lifts a 400 carrying
 * `invalid_grant` from `persistent` to `reauth_required` so the connection
 * surfaces the reconnect prompt. Internal to `classifyOuraError`.
 */
function isInvalidGrant(err: unknown): boolean {
  return isOAuthInvalidGrant(err, "Oura");
}

export function classifyOuraError(err: unknown): IntegrationClassification {
  if (isInvalidGrant(err)) return "reauth_required";
  return classifyIntegrationError(err, "Oura");
}
