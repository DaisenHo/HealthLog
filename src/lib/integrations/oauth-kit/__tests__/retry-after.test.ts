import { describe, expect, it } from "vitest";
import {
  parseRetryAfterMs,
  RETRY_AFTER_CAP_MS,
  retryAfterMsOf,
} from "../retry-after";

const NOW = Date.parse("2026-10-21T12:00:00.000Z");

describe("parseRetryAfterMs", () => {
  it("reads delay seconds", () => {
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
    expect(parseRetryAfterMs(" 1.5 ", NOW)).toBe(1_500);
  });

  it("reads an HTTP date, a past one as zero", () => {
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 12:01:00 GMT", NOW)).toBe(
      60_000,
    );
    expect(parseRetryAfterMs("Wed, 21 Oct 2026 11:00:00 GMT", NOW)).toBe(0);
  });

  it("caps an absurd wait", () => {
    expect(parseRetryAfterMs("999999999", NOW)).toBe(RETRY_AFTER_CAP_MS);
  });

  it("ignores what it cannot read", () => {
    expect(parseRetryAfterMs(null, NOW)).toBeUndefined();
    expect(parseRetryAfterMs("", NOW)).toBeUndefined();
    expect(parseRetryAfterMs("soon", NOW)).toBeUndefined();
    expect(parseRetryAfterMs("-5", NOW)).toBeUndefined();
  });

  it("reads it off a response", () => {
    const res = new Response(null, {
      status: 429,
      headers: { "Retry-After": "7" },
    });
    expect(retryAfterMsOf(res, NOW)).toBe(7_000);
  });
});
