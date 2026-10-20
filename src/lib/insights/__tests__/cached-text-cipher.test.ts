import { Buffer } from "node:buffer";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging/context", () => ({ getEvent: () => undefined }));

import { encryptBytes } from "@/lib/crypto";
import {
  INSIGHTS_CACHE_CLEARED,
  INSIGHTS_CACHE_SELECT,
  insightsCacheWrite,
  openInsightsCachedText,
  sealInsightsCachedText,
} from "../cached-text-cipher";

const PAYLOAD = JSON.stringify({ dailyBriefing: { paragraph: "Sleep held." } });

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEYS", "");
  vi.stubEnv("ENCRYPTION_ACTIVE_KEY_ID", "");
  vi.stubEnv("ENCRYPTION_KEY", "b".repeat(64));
});
afterEach(() => vi.unstubAllEnvs());

describe("cached insights payload at rest", () => {
  it("writes ciphertext and nulls the readable column in the same write", () => {
    const data = insightsCacheWrite(PAYLOAD);
    expect(data.insightsCachedText).toBeNull();
    expect(
      Buffer.from(data.insightsCachedTextEncrypted).toString("utf8"),
    ).not.toContain("Sleep held");
    expect(openInsightsCachedText(data)).toBe(PAYLOAD);
  });

  it("falls back to the readable column for a row the backfill has not reached", () => {
    expect(
      openInsightsCachedText({
        insightsCachedText: PAYLOAD,
        insightsCachedTextEncrypted: null,
      }),
    ).toBe(PAYLOAD);
  });

  // This used to prefer the readable column, the one sealed column read
  // that way. Every sealed column now reads the ciphertext first.
  it("reads a sealed value before a readable one beside it", () => {
    expect(
      openInsightsCachedText({
        insightsCachedText: "readable",
        insightsCachedTextEncrypted: sealInsightsCachedText("sealed"),
      }),
    ).toBe("sealed");
  });

  it("never serves the readable value in place of a sealed one that does not open", () => {
    const foreign = encryptBytes(Buffer.from(PAYLOAD, "utf8"), "other/v1");
    expect(
      openInsightsCachedText({
        insightsCachedText: "readable",
        insightsCachedTextEncrypted: new Uint8Array(foreign),
      }),
    ).toBeNull();
  });

  it("does not open a value sealed for another purpose", () => {
    const foreign = encryptBytes(Buffer.from(PAYLOAD, "utf8"), "other/v1");
    expect(
      openInsightsCachedText({
        insightsCachedText: null,
        insightsCachedTextEncrypted: new Uint8Array(foreign),
      }),
    ).toBeNull();
  });

  it("reads an empty row as no cache", () => {
    expect(openInsightsCachedText(null)).toBeNull();
    expect(openInsightsCachedText({ ...INSIGHTS_CACHE_CLEARED })).toBeNull();
  });

  it("is fail-closed on write: no key, no payload", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => insightsCacheWrite(PAYLOAD)).toThrow();
  });

  it("clears and selects both columns", () => {
    expect(INSIGHTS_CACHE_CLEARED).toEqual({
      insightsCachedText: null,
      insightsCachedTextEncrypted: null,
    });
    expect(Object.keys(INSIGHTS_CACHE_SELECT).sort()).toEqual([
      "insightsCachedText",
      "insightsCachedTextEncrypted",
    ]);
  });
});
