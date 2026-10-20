/**
 * How a deprecated route says so: on the wire, and in the operator's log.
 *
 * `/api/feature-flags` was marked deprecated with a bare `Deprecation: true`
 * and no date at all: a client could learn that the route was going, never
 * when, and the operator could not tell which builds still called it, so the
 * removal criterion ("the first release after the native build that reads
 * `ai` ships") could not be checked against anything. A deprecation is now one
 * reviewed notice per route, applied with {@link deprecated}:
 *
 *   - `Deprecation: @<unix seconds>` — when it was deprecated (RFC 9745);
 *   - `Sunset: <HTTP-date>` — from when the route may stop answering
 *     (RFC 8594);
 *   - `Link: <successor>; rel="successor-version"` — where to go instead;
 *   - a wide-event annotation naming the route's notice and the calling
 *     client build, read off the `User-Agent`, so the log answers "who still
 *     calls this" before the sunset arrives.
 *
 * The notices live in {@link DEPRECATIONS}, so the dates are in one place and
 * `deprecation.test.ts` holds each route that applies one to the OpenAPI
 * `deprecated` flag.
 */
import { annotate } from "@/lib/logging/context";
import { dayKeyAsUtcMidnight } from "@/lib/tz/date-only";

export interface DeprecationNotice {
  /** The day the route was deprecated, `YYYY-MM-DD` (UTC). */
  since: string;
  /** The first day the route may stop answering, `YYYY-MM-DD` (UTC). */
  sunset: string;
  /** The path that replaces it, when there is one. */
  successor?: string;
}

/**
 * Every route that answers as deprecated, with its dates.
 *
 * `/api/feature-flags`: deprecated in v1.39.0 (2026-09-24), when `ai` on
 * `GET /api/auth/me` replaced it. The shipped native build still reads it, so
 * the sunset leaves two native release cycles.
 */
export const DEPRECATIONS = {
  "/api/feature-flags": {
    since: "2026-09-24",
    sunset: "2027-03-31",
    successor: "/api/auth/me",
  },
} as const satisfies Record<string, DeprecationNotice>;

export type DeprecatedRoute = keyof typeof DEPRECATIONS;

/**
 * A notice day as the instant the header states. Both headers carry instants,
 * and a deprecation published for every client has no one person's day to
 * start from, so the day is read as UTC midnight: the label form.
 */
function utcDay(day: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new Error(`Deprecation date must be YYYY-MM-DD, got "${day}"`);
  }
  return dayKeyAsUtcMidnight(day);
}

/**
 * The calling client, coarsely: `ios/<version>` for the native app (its
 * `User-Agent` is `HealthLog-iOS/<version> (<bundle id>)`), `web` for a
 * browser, `other` for anything else, null with no header.
 */
export function clientBuildOf(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const ios = /^HealthLog-iOS\/([0-9][0-9A-Za-z.+-]{0,31})/.exec(userAgent);
  if (ios) return `ios/${ios[1]}`;
  if (/^Mozilla\//.test(userAgent)) return "web";
  return "other";
}

/** Mark a response as coming from a deprecated route, and log who asked. */
export function deprecated<R extends Response>(
  response: R,
  route: DeprecatedRoute,
  request: Request,
): R {
  const notice: DeprecationNotice = DEPRECATIONS[route];
  const since = utcDay(notice.since);
  const sunset = utcDay(notice.sunset);
  response.headers.set("Deprecation", `@${Math.floor(since.getTime() / 1000)}`);
  response.headers.set("Sunset", sunset.toUTCString());
  if (notice.successor) {
    response.headers.append(
      "Link",
      `<${notice.successor}>; rel="successor-version"`,
    );
  }
  annotate({
    meta: {
      deprecated_route: route,
      deprecation_sunset: notice.sunset,
      client_build: clientBuildOf(request.headers.get("user-agent")),
    },
  });
  return response;
}
