/**
 * First-paint locale ladder (root layout): User.locale → cookie →
 * Accept-Language → "en" hard floor.
 *
 * The User.locale step is the Safari-ITP fix: the script-written
 * `healthlog-locale` cookie expires after 7 days there, and before this
 * ladder existed the first paint fell back to the browser language once
 * a week even though the user had explicitly chosen one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCookies = vi.fn();
const mockHeaders = vi.fn();
vi.mock("next/headers", () => ({
  cookies: (...args: unknown[]) => mockCookies(...args),
  headers: (...args: unknown[]) => mockHeaders(...args),
}));

const mockGetSessionUserLocale = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  getSessionUserLocale: (...args: unknown[]) =>
    mockGetSessionUserLocale(...args),
}));

import { resolveInitialLocale } from "@/lib/i18n/resolve-initial-locale";

function cookieStoreWith(value: string | undefined) {
  return {
    get: (name: string) =>
      name === "healthlog-locale" && value !== undefined
        ? { name, value }
        : undefined,
  };
}

function headersWith(acceptLanguage: string | null) {
  return {
    get: (name: string) =>
      name.toLowerCase() === "accept-language" ? acceptLanguage : null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue(cookieStoreWith(undefined));
  mockHeaders.mockResolvedValue(headersWith(null));
  mockGetSessionUserLocale.mockResolvedValue(null);
});

describe("resolveInitialLocale", () => {
  it("uses the cookie for a guest without an account preference", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith("de"));
    await expect(resolveInitialLocale()).resolves.toBe("de");
    expect(mockGetSessionUserLocale).toHaveBeenCalledOnce();
  });

  it("ignores an unsupported cookie value and walks the ladder", async () => {
    mockCookies.mockResolvedValue(cookieStoreWith("tlh"));
    mockGetSessionUserLocale.mockResolvedValue("fr");
    await expect(resolveInitialLocale()).resolves.toBe("fr");
  });

  it("falls back to User.locale on a cookie miss (the ITP case)", async () => {
    mockGetSessionUserLocale.mockResolvedValue("pl");
    mockHeaders.mockResolvedValue(headersWith("en-US,en;q=0.9"));
    await expect(resolveInitialLocale()).resolves.toBe("pl");
  });

  it("ignores an unsupported User.locale value", async () => {
    mockGetSessionUserLocale.mockResolvedValue("tlh");
    mockHeaders.mockResolvedValue(headersWith("it-IT,it;q=0.9"));
    await expect(resolveInitialLocale()).resolves.toBe("it");
  });

  it("uses Accept-Language when there is no cookie and no session", async () => {
    mockHeaders.mockResolvedValue(headersWith("es-ES,es;q=0.9,en;q=0.5"));
    await expect(resolveInitialLocale()).resolves.toBe("es");
  });

  it("survives a session-read failure and still honours Accept-Language", async () => {
    mockGetSessionUserLocale.mockRejectedValue(new Error("db down"));
    mockHeaders.mockResolvedValue(headersWith("de-DE,de;q=0.9"));
    await expect(resolveInitialLocale()).resolves.toBe("de");
  });

  it("hard-floors to en when cookies() itself throws", async () => {
    mockCookies.mockRejectedValue(new Error("DynamicServerError"));
    await expect(resolveInitialLocale()).resolves.toBe("en");
  });
});
