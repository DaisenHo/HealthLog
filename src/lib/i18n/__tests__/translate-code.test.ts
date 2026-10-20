import { describe, expect, it } from "vitest";

import {
  translateCode,
  translateCodeOrNull,
  translateOrNull,
} from "../translate-code";

const CATALOGUE: Record<string, string> = {
  "apiErrors.sharing.invite.self": "That is your own record.",
  "common.error": "Something went wrong.",
  "greeting.hello": "Hello {name}",
};

// Echoes the key on a miss, the way the real translator does.
function t(key: string, params?: Record<string, string | number>): string {
  const value = CATALOGUE[key];
  if (value === undefined) return key;
  return params ? value.replace("{name}", String(params.name)) : value;
}

describe("translate-code", () => {
  it("answers null for a key the catalogue does not carry", () => {
    expect(translateOrNull(t, "missing.key")).toBeNull();
    expect(translateOrNull(t, "greeting.hello", { name: "A" })).toBe("Hello A");
  });

  it("translates a code under its namespace, or answers null", () => {
    expect(translateCodeOrNull(t, "apiErrors", "sharing.invite.self")).toBe(
      "That is your own record.",
    );
    expect(translateCodeOrNull(t, "apiErrors", "http.not_found")).toBeNull();
    expect(translateCodeOrNull(t, "apiErrors", undefined)).toBeNull();
    expect(translateCodeOrNull(t, "apiErrors", "")).toBeNull();
  });

  it("falls back to the fallback key's sentence", () => {
    expect(
      translateCode(t, "apiErrors", "http.not_found", "common.error"),
    ).toBe("Something went wrong.");
    expect(translateCode(t, "apiErrors", null, "common.error")).toBe(
      "Something went wrong.",
    );
  });
});
