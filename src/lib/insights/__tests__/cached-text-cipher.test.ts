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
  it("writes ciphertext only", () => {
    const data = insightsCacheWrite(PAYLOAD);
    expect(Object.keys(data)).toEqual(["insightsCachedTextEncrypted"]);
    expect(
      Buffer.from(data.insightsCachedTextEncrypted).toString("utf8"),
    ).not.toContain("Sleep held");
    expect(openInsightsCachedText(data)).toBe(PAYLOAD);
  });

  it("reads a sealed value", () => {
    expect(
      openInsightsCachedText({
        insightsCachedTextEncrypted: sealInsightsCachedText("sealed"),
      }),
    ).toBe("sealed");
  });

  it("does not open a value sealed for another purpose", () => {
    const foreign = encryptBytes(Buffer.from(PAYLOAD, "utf8"), "other/v1");
    expect(
      openInsightsCachedText({
        insightsCachedTextEncrypted: new Uint8Array(foreign),
      }),
    ).toBeNull();
  });

  it("reads an empty row as no cache", () => {
    expect(openInsightsCachedText(null)).toBeNull();
    expect(openInsightsCachedText({ ...INSIGHTS_CACHE_CLEARED })).toBeNull();
    expect(
      openInsightsCachedText({ insightsCachedTextEncrypted: new Uint8Array() }),
    ).toBeNull();
  });

  it("is fail-closed on write: no key, no payload", () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    expect(() => insightsCacheWrite(PAYLOAD)).toThrow();
  });

  it("clears and selects the sealed column", () => {
    expect(INSIGHTS_CACHE_CLEARED).toEqual({
      insightsCachedTextEncrypted: null,
    });
    expect(Object.keys(INSIGHTS_CACHE_SELECT)).toEqual([
      "insightsCachedTextEncrypted",
    ]);
  });
});
