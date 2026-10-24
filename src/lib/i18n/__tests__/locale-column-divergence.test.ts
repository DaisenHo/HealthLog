/** Account language wins over stale browser preferences; guests still follow their browser. */
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

vi.mock("@/lib/app-settings", () => ({
  getOperatorDefaultLocale: vi.fn(async () => null),
}));

import { resolveInitialLocale } from "@/lib/i18n/resolve-initial-locale";
import { resolveJobLocale } from "@/lib/i18n/job-locale";

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

describe("account language and browser language", () => {
  it("keeps a guest browser preference separate from account defaults", async () => {
    // With no signed-in session, the browser preference is independent of
    // the default used for an account that has not chosen a language.
    mockGetSessionUserLocale.mockResolvedValue(null);
    mockHeaders.mockResolvedValue(headersWith("de-DE,de;q=0.9,en;q=0.5"));

    await expect(resolveInitialLocale()).resolves.toBe("de");
    await expect(resolveJobLocale(null)).resolves.toBe("en");
  });

  it("a stale cookie cannot change the account interface or background language", async () => {
    // The picker was used at some point, so the cookie carries German —
    // but the column was left holding the language of the paint that
    // preceded the choice.
    mockCookies.mockResolvedValue(cookieStoreWith("de"));
    mockGetSessionUserLocale.mockResolvedValue("en");

    await expect(resolveInitialLocale()).resolves.toBe("en");
    await expect(resolveJobLocale("en")).resolves.toBe("en");
  });

  it("a cached language does not bypass the account lookup", async () => {
    // Which is why the divergence is invisible: nothing the user looks at
    // reads the column, so a wrong column produces no wrong screen until a
    // job writes a sentence with it.
    mockCookies.mockResolvedValue(cookieStoreWith("de"));
    mockGetSessionUserLocale.mockResolvedValue("en");
    await expect(resolveInitialLocale()).resolves.toBe("en");
    expect(mockGetSessionUserLocale).toHaveBeenCalledOnce();
  });
});
