/**
 * How long to wait after a Strava 429, read from the response's own headers.
 *
 * What a rate limit does to a running sync (the activities read before it
 * land, the cursor moves only as far as an oldest-first walk proves, the
 * backfill waits out the window before its next run) is pinned against
 * Postgres in `tests/integration/strava-sync.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { stravaRateLimitRetryAfterSeconds } from "../client";

describe("stravaRateLimitRetryAfterSeconds", () => {
  const at = new Date("2026-10-21T10:07:30Z");

  it("waits for the next quarter hour when the short window is spent", () => {
    const headers = new Headers({
      "X-RateLimit-Limit": "200,2000",
      "X-RateLimit-Usage": "200,950",
    });
    expect(stravaRateLimitRetryAfterSeconds(headers, at)).toBe(450);
  });

  it("waits for midnight UTC when the daily limit is spent", () => {
    const headers = new Headers({
      "X-ReadRateLimit-Limit": "100,1000",
      "X-ReadRateLimit-Usage": "40,1000",
    });
    expect(stravaRateLimitRetryAfterSeconds(headers, at)).toBe(
      13 * 3600 + 52 * 60 + 30,
    );
  });

  it("honours a Retry-After header when one is sent", () => {
    expect(
      stravaRateLimitRetryAfterSeconds(
        new Headers({ "Retry-After": "120" }),
        at,
      ),
    ).toBe(120);
  });

  it("falls back to the next quarter hour without any header", () => {
    expect(stravaRateLimitRetryAfterSeconds(new Headers(), at)).toBe(450);
  });
});
