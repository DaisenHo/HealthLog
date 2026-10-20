/**
 * The `meta.errorCode` an error envelope carries when its route named none.
 *
 * `meta.errorCode` is what a client is told to branch on, and roughly half of
 * the refusals in the tree carried one: the rest answered prose alone, so a
 * client could branch on the code for one 404 and had to fall back to the
 * status for the next. Every error envelope now has a code. A route that names
 * its own keeps it; one that does not gets the status's code from this table,
 * so the generic family is predictable from the status alone and a client
 * never has to special-case an absent field.
 *
 * Deliberately coarse. These say which kind of refusal it was, never why —
 * a route that has a reason worth branching on names its own code. Statuses
 * not listed fall back to `http.client_error` / `http.server_error`.
 */
export const DEFAULT_ERROR_CODES = {
  400: "http.bad_request",
  401: "http.unauthenticated",
  403: "http.forbidden",
  404: "http.not_found",
  405: "http.method_not_allowed",
  409: "http.conflict",
  410: "http.gone",
  413: "http.payload_too_large",
  415: "http.unsupported_media_type",
  422: "http.invalid",
  429: "http.rate_limited",
  500: "http.internal",
  502: "http.bad_gateway",
  503: "http.unavailable",
  504: "http.gateway_timeout",
  client: "http.client_error",
  server: "http.server_error",
} as const;

/** The default code for an error status, see {@link DEFAULT_ERROR_CODES}. */
export function defaultErrorCodeForStatus(status: number): string {
  const listed = (DEFAULT_ERROR_CODES as Record<number, string | undefined>)[
    status
  ];
  if (listed) return listed;
  return status >= 500
    ? DEFAULT_ERROR_CODES.server
    : DEFAULT_ERROR_CODES.client;
}
