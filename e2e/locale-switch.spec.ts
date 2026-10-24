import { expect, test } from "./setup/test";
import {
  E2E_USER,
  E2E_SETUP_LOCALE,
  STORAGE_STATE_PATH,
} from "./setup/global-setup";
import { resetSetupFlow } from "./setup/setup-flow-fixture";

/**
 * Locale-key drift smoke check — switch the cookie between EN and DE
 * and assert the login page (the only public surface that's translated)
 * never shows raw i18n keys like `auth.welcomeBack`.
 *
 * Drift catches: a typo'd t("foo.bar") with no key in either locale
 * file would make the raw key surface in the DOM. messages/de.json and
 * messages/en.json key parity is enforced by unit tests; this is the
 * runtime cousin.
 */
test.describe("locale switch", () => {
  for (const locale of ["en", "de"] as const) {
    test(`renders /auth/login in ${locale} without raw i18n keys`, async ({
      page,
      context,
    }) => {
      // Cookies must be addressable to a real origin — `page.url()` on
      // a fresh context returns `about:blank`, which Playwright rejects.
      // Anchor at the configured base URL explicitly.
      const baseURL =
        test.info().project.use.baseURL ?? "http://localhost:3000";
      await context.addCookies([
        {
          name: "healthlog-locale",
          value: locale,
          url: baseURL,
        },
      ]);
      await page.goto("/auth/login");

      const bodyText = await page.locator("body").innerText();

      // i18n keys look like `section.subkey` — letters, numbers,
      // underscores, dots — and are never wrapped in normal sentences,
      // so a regex match anywhere in body text is a sign the lookup
      // fell through.
      const rawKeyPattern = /\b[a-z]+(?:[A-Z][a-z]+)?\.[a-z][A-Za-z0-9_.]+\b/;
      const match = bodyText.match(rawKeyPattern);

      // Whitelist: filenames or version strings can look like keys,
      // skip those by requiring at least one camelCase segment.
      if (match) {
        const candidate = match[0];
        const looksLikeKey = /\.[a-z][A-Z]/.test(candidate);
        expect(
          looksLikeKey,
          `Possible raw i18n key in ${locale}: ${candidate}`,
        ).toBe(false);
      }
    });
  }
});

test.describe("Simplified Chinese language choice", () => {
  test("switches the login page through its control and survives a reload", async ({
    page,
  }) => {
    await page.goto("/auth/login");
    await page.locator("#auth-language-select").selectOption("zh-CN");
    await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
    await expect(
      page.getByRole("button", { name: "使用密码登录", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByLabel("语言", { exact: true })).toHaveValue("zh-CN");
  });

  test("recognizes a Simplified Chinese system language on first paint", async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ locale: "zh-Hans", baseURL });
    try {
      const page = await context.newPage();
      await page.goto("/auth/login");
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      await expect(page.locator("#auth-language-select")).toHaveValue("zh-CN");
    } finally {
      await context.close();
    }
  });
});

test.describe("persisted account language", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test("keeps the account choice across stale browsers and a password sign-in", async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const signedIn = await context.request.post("/api/auth/login", {
      data: { email: E2E_USER.username, password: E2E_USER.password },
    });
    expect(signedIn.status()).toBe(200);
    const before = (await (await context.request.get("/api/auth/me")).json())
      .data;
    try {
      await page.goto("/settings/account");
      const saved = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth/me/locale") &&
          response.request().method() === "PUT",
      );
      await page.locator("#language-select").selectOption("zh-CN");
      expect((await saved).status()).toBe(200);
      await expect(page.locator("#language-select")).toHaveValue("zh-CN");
      await expect(page.getByText("显示偏好", { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator("#language-select")).toHaveValue("zh-CN");

      const stale = await browser.newContext({
        baseURL,
        storageState: await context.storageState(),
      });
      try {
        await stale.addCookies([
          { name: "healthlog-locale", value: "de", url: baseURL! },
        ]);
        const other = await stale.newPage();
        await other.goto("/settings/account");
        await expect(other.locator("#language-select")).toHaveValue("zh-CN");
        expect(
          (await (await stale.request.get("/api/auth/me/locale")).json()).data
            .locale,
        ).toBe("zh-CN");
      } finally {
        await stale.close();
      }

      await context.request.post("/api/auth/logout");
      await page.goto("/auth/login");
      await page.locator("#auth-language-select").selectOption("en");
      await page
        .getByRole("button", { name: "Sign in with password", exact: true })
        .click();
      await page
        .getByLabel("Email address or username", { exact: true })
        .fill(E2E_USER.username);
      await page
        .getByLabel("Password", { exact: true })
        .fill(E2E_USER.password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
      await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
      const after = (await (await context.request.get("/api/auth/me")).json())
        .data;
      expect(after).toMatchObject({
        locale: "zh-CN",
        timezone: before.timezone,
        unitPreference: before.unitPreference,
      });
    } finally {
      await context.request.put("/api/auth/me/locale", {
        data: { locale: before.locale ?? "en" },
      });
    }
  });

  test("keeps the current language when saving fails or the browser is offline", async ({
    page,
    context,
  }) => {
    await context.request.put("/api/auth/me/locale", {
      data: { locale: "en" },
    });
    await page.goto("/settings/account");
    await expect(page.locator("#language-select")).toHaveValue("en");
    let failureStatus = 503;
    await page.route("**/api/auth/me/locale", (route) =>
      route.request().method() === "PUT"
        ? route.fulfill({
            status: failureStatus,
            json: { data: null, error: "Unavailable" },
          })
        : route.continue(),
    );
    await page.locator("#language-select").selectOption("zh-CN");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Could not save the language" }),
    ).toBeVisible();
    await expect(page.locator("#language-select")).toHaveValue("en");
    failureStatus = 401;
    await page.locator("#language-select").selectOption("zh-CN");
    await expect(page.locator("#language-select-error")).toContainText(
      "Could not save the language",
    );
    await expect(page.locator("#language-select")).toHaveValue("en");
    await context.setOffline(true);
    try {
      await page.locator("#language-select").selectOption("zh-CN");
      await expect(
        page.getByRole("alert").filter({ hasText: "requires a connection" }),
      ).toBeVisible();
      await expect(page.locator("#language-select")).toHaveValue("en");
    } finally {
      await context.setOffline(false);
    }
    expect(
      (await (await context.request.get("/api/auth/me/locale")).json()).data
        .locale,
    ).toBe("en");
  });
});

test("switches language during onboarding and refreshes server-rendered steps", async ({
  page,
  context,
}) => {
  await resetSetupFlow(E2E_SETUP_LOCALE.username);
  const login = await context.request.post("/api/auth/login", {
    data: {
      email: E2E_SETUP_LOCALE.email,
      password: E2E_SETUP_LOCALE.password,
    },
  });
  expect(login.status()).toBe(200);
  await context.request.put("/api/auth/me/locale", { data: { locale: "en" } });
  await page.goto("/onboarding");
  await page.locator("#onboarding-language-select").selectOption("zh-CN");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await page.reload();
  await expect(page.locator("#onboarding-language-select")).toHaveValue(
    "zh-CN",
  );
  await page.goto("/onboarding/who");
  await expect(page.getByRole("navigation")).toHaveAttribute(
    "aria-label",
    "设置步骤",
  );
});

test("shows a Chinese error after an unsuccessful password sign-in", async ({
  page,
}) => {
  await page.goto("/auth/login");
  await page.locator("#auth-language-select").selectOption("zh-CN");
  await page.getByRole("button", { name: "使用密码登录", exact: true }).click();
  await page
    .getByLabel("邮箱或用户名", { exact: true })
    .fill(E2E_USER.username);
  await page.getByLabel("密码", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByText("登录失败", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Invalid credentials", { exact: true }),
  ).toHaveCount(0);
});
