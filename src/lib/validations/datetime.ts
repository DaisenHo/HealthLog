/**
 * The one ISO 8601 instant validator every schema uses.
 *
 * Since v1.43 an instant must carry seconds: `2026-10-15T06:15:00Z`,
 * `2026-10-15T06:15:00.000Z` and `2026-10-15T06:15:00+02:00` pass,
 * `2026-10-15T06:15Z` is refused. zod 4.5 made that the behaviour of
 * `z.iso.datetime()`; routing every call site through this helper keeps the
 * rule in one place, gives the refusal a message that says what is missing,
 * and counts each refusal so a client that still sends minute-precision
 * instants shows up in the logs before its users do.
 *
 * `src/__tests__/datetime-helper-guard.test.ts` forbids a direct
 * `z.iso.datetime(` or `z.string().datetime(` anywhere else under `src/`.
 *
 * Client-safe: the counter goes through an observer the server logging module
 * registers on import (the same pattern as `registerSourcePriorityParseObserver`),
 * so a form that validates with these schemas never pulls `node:async_hooks`
 * into the browser bundle.
 */
import { z } from "zod/v4";

/** Wide-event meta key: how many instants this request refused for lacking seconds. */
export const DATETIME_NO_SECONDS_COUNTER = "validation.datetime.no_seconds";

/** Message for an instant that would be valid if it carried seconds. */
export const DATETIME_NO_SECONDS_MESSAGE =
  "Invalid ISO datetime: seconds are required (YYYY-MM-DDTHH:mm:ssZ)";

// Date, hours and minutes, then an optional zone and nothing else: the shape a
// minute-precision encoder produces. Only this shape counts, so the counter
// measures exactly the clients the seconds rule turned away and not every
// malformed string. A field that requires `Z` does not count an offset form,
// which it would refuse with seconds too.
const MINUTE_PRECISION_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const MINUTE_PRECISION_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}Z$/;

type NoSecondsObserver = () => void;
let noSecondsObserver: NoSecondsObserver = () => {};

/**
 * Server-side opt-in for the refusal counter. Called once from
 * `@/lib/logging/context`; the browser keeps the no-op default.
 */
export function registerDatetimeNoSecondsObserver(
  observer: NoSecondsObserver,
): void {
  noSecondsObserver = observer;
}

export interface IsoDateTimeOptions {
  /**
   * Accept a numeric UTC offset (`+02:00`) besides `Z`. Default `true`;
   * `false` keeps the handful of fields that have always required `Z`.
   */
  offset?: boolean;
  /** Message for every other refusal; zod's default when omitted. */
  message?: string;
}

/**
 * An ISO 8601 instant with seconds. Use it for every timestamp a schema
 * accepts or publishes; chain `.optional()`, `.nullable()`, `.describe()` and
 * `.meta()` as on any zod string.
 */
export function isoDateTime(options: IsoDateTimeOptions = {}) {
  const { offset = true, message } = options;
  const minutePrecision = offset
    ? MINUTE_PRECISION_OFFSET
    : MINUTE_PRECISION_UTC;
  return (
    z.iso
      .datetime({
        offset,
        // zod builds issue messages lazily, when a caller first reads them,
        // so this callback only words the refusal; it cannot count it.
        error: (issue) =>
          typeof issue.input === "string" && minutePrecision.test(issue.input)
            ? DATETIME_NO_SECONDS_MESSAGE
            : message,
      })
      // The count runs here instead: a refinement runs on every parse of a
      // string, even after the format check failed, and adds no issue.
      .refine((value) => {
        if (minutePrecision.test(value)) noSecondsObserver();
        return true;
      })
  );
}
