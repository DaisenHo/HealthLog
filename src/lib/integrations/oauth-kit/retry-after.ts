/**
 * How long a provider asked to be left alone after a 429 or 503.
 *
 * `Retry-After` comes in two forms (RFC 9110 10.2.3): a number of seconds, or
 * an HTTP date. Every provider client reads it through here, so a date form is
 * not honoured by one provider and ignored by the next.
 */

/** Upper bound on any wait a provider can ask for, so a bad header cannot park a job for days. */
export const RETRY_AFTER_CAP_MS = 24 * 60 * 60 * 1000;

/**
 * The delay a `Retry-After` value asks for, in ms, or undefined when the value
 * is absent or unreadable. A date in the past reads as 0.
 */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now: number = Date.now(),
): number | undefined {
  const header = value?.trim();
  if (!header) return undefined;
  if (/^\d+(?:\.\d+)?$/.test(header)) {
    return Math.min(
      RETRY_AFTER_CAP_MS,
      Math.round(Number.parseFloat(header) * 1000),
    );
  }
  // An HTTP date always names its weekday and month; a bare number that is not
  // a delay (a negative one) is not a date either, whatever Date.parse thinks.
  if (!/[a-z]/i.test(header)) return undefined;
  const at = Date.parse(header);
  if (!Number.isFinite(at)) return undefined;
  return Math.min(RETRY_AFTER_CAP_MS, Math.max(0, at - now));
}

/** The `Retry-After` delay of a response, in ms. */
export function retryAfterMsOf(
  res: Pick<Response, "headers">,
  now: number = Date.now(),
): number | undefined {
  return parseRetryAfterMs(res.headers.get("retry-after"), now);
}
