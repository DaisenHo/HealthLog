import { describe, it, expect } from "vitest";
import {
  CLIENT_ABORT_MARGIN_MS,
  clientAbortMs,
  PROVIDER_DEFAULT_TIMEOUT_MS,
  resolveEffectiveTimeoutMs,
} from "../effective-timeout";

const BUDGET = 120_000;

describe("resolveEffectiveTimeoutMs", () => {
  it("converts a positive per-user setting from seconds to ms", () => {
    expect(resolveEffectiveTimeoutMs(300, BUDGET)).toBe(300_000);
    expect(resolveEffectiveTimeoutMs(10, BUDGET)).toBe(10_000);
  });

  it("falls back to the budget default when the setting is unset", () => {
    expect(resolveEffectiveTimeoutMs(null, BUDGET)).toBe(BUDGET);
    expect(resolveEffectiveTimeoutMs(undefined, BUDGET)).toBe(BUDGET);
  });

  it("falls back to the budget default for a non-positive value", () => {
    expect(resolveEffectiveTimeoutMs(0, BUDGET)).toBe(BUDGET);
    expect(resolveEffectiveTimeoutMs(-5, BUDGET)).toBe(BUDGET);
  });

  it("honours different budget defaults per surface", () => {
    expect(resolveEffectiveTimeoutMs(null, 60_000)).toBe(60_000);
    expect(resolveEffectiveTimeoutMs(45, 60_000)).toBe(45_000);
  });
});

describe("clientAbortMs (#1267)", () => {
  it("waits the published setting per call plus the margin", () => {
    expect(clientAbortMs(600_000, 2)).toBe(
      2 * 600_000 + CLIENT_ABORT_MARGIN_MS,
    );
  });

  it("never waits less per call than the route's own longer default", () => {
    // 60 s is what the payload publishes when nothing is set; the briefing
    // route gives each call 180 s then.
    expect(clientAbortMs(60_000, 2, 180_000)).toBe(
      2 * 180_000 + CLIENT_ABORT_MARGIN_MS,
    );
    expect(clientAbortMs(600_000, 2, 180_000)).toBe(
      2 * 600_000 + CLIENT_ABORT_MARGIN_MS,
    );
  });

  it("reads a missing value as the provider default", () => {
    expect(clientAbortMs(undefined, 1)).toBe(
      PROVIDER_DEFAULT_TIMEOUT_MS + CLIENT_ABORT_MARGIN_MS,
    );
  });
});
