/**
 * Incoming `x-request-id` acceptance.
 *
 * The header is client-controlled, and the value is echoed on the response
 * and written into every log line of the request. Only a plain correlation
 * token is adopted — letters, digits and hyphens, 8 to 64 characters, which
 * covers a UUID and every proxy-generated id in use — so a caller cannot
 * inject quotes, markup or log-shaped text through it. Anything else is
 * dropped and the request gets a fresh id.
 *
 * Edge-safe: no Node imports, because `src/proxy.ts` reads it too.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** The incoming id when it is well-formed, else `null`. */
export function acceptIncomingRequestId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") return null;
  return REQUEST_ID_PATTERN.test(value) ? value : null;
}

/** The incoming id when it is well-formed, else a fresh UUID. */
export function resolveRequestId(value: string | null | undefined): string {
  return acceptIncomingRequestId(value) ?? crypto.randomUUID();
}
