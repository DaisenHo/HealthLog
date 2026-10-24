import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as GET_LOCALE, PUT } from "@/app/api/auth/me/locale/route";
import { POST as REGISTER } from "@/app/api/auth/register/route";
import { resolveJobLocale } from "@/lib/i18n/job-locale";
import { GET } from "@/app/api/auth/me/route";
import { anonymous, callRoute } from "../../kit/call-route";
import { makeSession, makeToken, makeUser } from "../../kit/factories";
import { getPrismaClient, truncateAllTables } from "../setup";

const prisma = getPrismaClient();

beforeEach(() => truncateAllTables(prisma));

describe("account language", () => {
  it("uses the same fallback for account reads and background jobs before the first choice", async () => {
    await prisma.appSettings.create({
      data: { id: "singleton", defaultLocale: "de" },
    });
    const user = await makeUser({ locale: null });
    const auth = await makeSession(user);
    const account = await callRoute<{ locale: string }>(GET, {
      method: "GET",
      route: "/api/auth/me",
      auth,
    });
    const language = await callRoute<{ locale: string }>(GET_LOCALE, {
      method: "GET",
      route: "/api/auth/me/locale",
      auth,
    });
    expect(account.data?.locale).toBe(await resolveJobLocale(null));
    expect(language.data?.locale).toBe("de");
  });

  it("stores a new account's language before its first signed-in request", async () => {
    vi.stubEnv("PASSWORD_BREACH_CHECK_DISABLED", "true");
    try {
      const registered = await callRoute(REGISTER, {
        method: "POST",
        route: "/api/auth/register",
        auth: anonymous,
        headers: { "accept-language": "zh-Hans" },
        body: {
          email: "language-signup@example.test",
          username: "language-signup",
          password: "Xq7!Mm4#Cv8@Nz2$",
        },
      });
      expect(registered.status).toBe(201);
      const user = await prisma.user.findUniqueOrThrow({
        where: { username: "language-signup" },
      });
      expect(user.locale).toBe("zh-CN");
      const restored = await callRoute<{ locale: string }>(GET_LOCALE, {
        method: "GET",
        route: "/api/auth/me/locale",
        auth: await makeToken(user),
      });
      expect(restored.data).toEqual({ locale: "zh-CN" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps Simplified Chinese across requests without changing other preferences", async () => {
    const user = await makeUser({
      locale: "en",
      timezone: "America/New_York",
      unitPreference: "imperial",
    });
    const auth = await makeSession(user);
    const saved = await callRoute<{ locale: string }>(PUT, {
      method: "PUT",
      route: "/api/auth/me/locale",
      body: { locale: "zh-CN" },
      auth,
    });
    expect(saved.status).toBe(200);
    expect(saved.data).toEqual({ locale: "zh-CN" });

    const restored = await callRoute<{
      locale: string;
      timezone: string;
      unitPreference: string;
    }>(GET, { method: "GET", route: "/api/auth/me", auth });
    expect(restored.status).toBe(200);
    expect(restored.data).toMatchObject({
      locale: "zh-CN",
      timezone: "America/New_York",
      unitPreference: "imperial",
    });
  });
  it("reads the same account language through a native Bearer token", async () => {
    const user = await makeUser({ locale: "zh-CN" });
    const result = await callRoute<{ locale: string }>(GET_LOCALE, {
      method: "GET",
      route: "/api/auth/me/locale",
      auth: await makeToken(user),
    });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ locale: "zh-CN" });
  });

  it("refuses an unsupported language without changing the saved preference", async () => {
    const user = await makeUser({ locale: "fr" });
    const auth = await makeSession(user);
    const refused = await callRoute(PUT, {
      method: "PUT",
      route: "/api/auth/me/locale",
      body: { locale: "invalid" },
      auth,
    });
    expect(refused.status).toBe(422);
    const restored = await callRoute<{ locale: string }>(GET_LOCALE, {
      method: "GET",
      route: "/api/auth/me/locale",
      auth,
    });
    expect(restored.data).toEqual({ locale: "fr" });
  });

  it("does not expose an account language to anonymous callers", async () => {
    const result = await callRoute(GET_LOCALE, {
      method: "GET",
      route: "/api/auth/me/locale",
      auth: anonymous,
    });
    expect(result.status).toBe(401);
  });
});
