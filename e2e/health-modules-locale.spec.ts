import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

import { expect, test } from "./setup/test";
import { HEALTH_MODULES_STORAGE_STATE_PATH } from "./setup/global-setup";

// One synthetic account and one project keep bilingual writes isolated.
test.use({ storageState: HEALTH_MODULES_STORAGE_STATE_PATH });
test.describe.configure({ mode: "default" });
const modules = [
  "illness",
  "labs",
  "mood",
  "vaccinations",
  "mentalHealth",
  "nutrients",
  "inboundDocuments",
] as const;
let originalModules: Record<string, boolean> = {};
let cycleEnabled = false;

test.beforeAll(async ({ request }) => {
  const prefs = await request.get("/api/auth/me/modules");
  expect(prefs.status()).toBe(200);
  originalModules = (await prefs.json()).data.modules;
  const cycle = await request.get("/api/auth/me/cycle-prefs");
  expect(cycle.status()).toBe(200);
  cycleEnabled = (await cycle.json()).data.cycleTrackingEnabled;
  expect(
    (
      await request.patch("/api/auth/me/modules", {
        data: Object.fromEntries(modules.map((key) => [key, true])),
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.patch("/api/auth/me/cycle-prefs", {
        data: { enabled: true },
      })
    ).status(),
  ).toBe(200);
});

test.afterAll(async ({ request }) => {
  expect(
    (
      await request.patch("/api/auth/me/modules", {
        data: Object.fromEntries(
          modules.map((key) => [key, originalModules[key]]),
        ),
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.patch("/api/auth/me/cycle-prefs", {
        data: { enabled: cycleEnabled },
      })
    ).status(),
  ).toBe(200);
});

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { data: T }).data;
}

async function writeFromUi<T = { id: string }>(
  page: Page,
  path: string,
  action: () => Promise<void>,
): Promise<T> {
  const written = page.waitForResponse(
    (res) =>
      new URL(res.url()).pathname === path && res.request().method() === "POST",
  );
  await action();
  const response = await written;
  expect(response.status()).toBe(201);
  return ((await response.json()) as { data: T }).data;
}

async function remove(page: Page, path: string, expectedStatus = 200) {
  expect((await page.request.delete(path)).status()).toBe(expectedStatus);
}

async function inLanguages(
  page: Page,
  run: (chinese: boolean, locale: string) => Promise<void>,
) {
  test.slow();
  page.setDefaultTimeout(30_000);
  const before = await read<{
    locale: string;
    timezone: string;
    unitPreference: string;
  }>(page, "/api/auth/me");
  try {
    for (const locale of ["en", "zh-CN"] as const) {
      await page.setViewportSize({
        width: locale === "zh-CN" ? 390 : 1280,
        height: 900,
      });
      await page.goto("/settings/account");
      await page.locator("#language-select").selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await run(locale === "zh-CN", locale);
      const after = await read(page, "/api/auth/me");
      expect(after).toMatchObject({
        locale,
        timezone: before.timezone,
        unitPreference: before.unitPreference,
      });
    }
  } finally {
    expect(
      (
        await page.request.put("/api/auth/me/locale", {
          data: { locale: before.locale },
        })
      ).status(),
    ).toBe(200);
  }
}

async function screenshot(page: Page, module: string, locale: string) {
  await page.screenshot({
    path: test.info().outputPath(`t05-${module}-${locale}.png`),
    fullPage: true,
  });
}

test("illness episodes save and remain readable in both languages", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/illness");
    await page
      .getByRole("button", {
        name: chinese ? "新建病程" : "New episode",
        exact: true,
      })
      .first()
      .click();
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.locator("#illness-label") });
    const label = `T05 fictional episode ${locale}`;
    await dialog.locator("#illness-label").fill(label);
    const row = await writeFromUi(page, "/api/illness/episodes", () =>
      dialog
        .getByRole("button", { name: chinese ? "保存" : "Save", exact: true })
        .click(),
    );
    try {
      expect(await read(page, `/api/illness/episodes/${row.id}`)).toMatchObject(
        { label, type: "INFECTION" },
      );
      await page.goto(`/illness/${row.id}`);
      await expect(page.locator("#main-content")).toContainText(label);
      await expect(page.locator("#main-content")).toContainText(
        chinese ? "每日时间线" : "Day timeline",
      );
      await screenshot(page, "illness", locale);
    } finally {
      await remove(page, `/api/illness/episodes/${row.id}`);
    }
  });
});

test("lab results validate, save and show their original number and unit", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    const name = `T05 fictional marker ${locale} ${Date.now()}`;
    const marker = await page.request.post("/api/biomarkers", {
      data: { name, unit: "mg/L", lowerBound: 10, upperBound: 20 },
    });
    expect(marker.status()).toBe(201);
    const markerId: string = (await marker.json()).data.id;
    let readingId: string | undefined;
    try {
      await page.goto("/labs");
      await page
        .locator("#main-content")
        .getByRole("button", {
          name: chinese
            ? /^(添加|添加首条检验结果)$/
            : /^(Add|Add your first result)$/,
        })
        .first()
        .click();
      const dialog = page
        .getByRole("dialog")
        .filter({ has: page.locator("#lab-biomarker") });
      await dialog.locator("#lab-biomarker").click();
      await page.getByRole("option", { name: new RegExp(name) }).click();
      await dialog.locator("#lab-value").fill("not-a-number");
      await dialog
        .getByRole("button", { name: chinese ? "保存" : "Save", exact: true })
        .click();
      await expect(dialog.getByRole("alert")).toContainText(
        chinese ? "请输入数值。" : "Enter a value.",
      );
      await dialog.locator("#lab-value").fill("12.3");
      await dialog.locator("#lab-note").fill(`T05 fictional note ${locale}`);
      const row = await writeFromUi(page, "/api/labs", () =>
        dialog
          .getByRole("button", { name: chinese ? "保存" : "Save", exact: true })
          .click(),
      );
      readingId = row.id;
      expect(await read(page, `/api/labs/${row.id}`)).toMatchObject({
        value: 12.3,
        unit: "mg/L",
      });
      await page.goto(`/labs/${markerId}/values`);
      await expect(page.locator("#main-content")).toContainText(name);
      await expect(page.locator("#main-content")).toContainText("12.3");
      await screenshot(page, "labs", locale);
    } finally {
      if (readingId) await remove(page, `/api/labs/${readingId}`);
      await remove(page, `/api/biomarkers/${markerId}`);
    }
  });
});

test("vaccinations preserve the chosen antigen and fictional lot", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/vaccinations");
    await page
      .locator(
        '[data-slot="vaccination-add"], [data-slot="vaccination-add-empty"]',
      )
      .filter({ visible: true })
      .first()
      .click();
    await page.locator('[data-slot="vaccination-catalog-trigger"]').click();
    await page
      .locator('[data-slot="vaccination-catalog-search"]')
      .fill(chinese ? "脊髓灰质炎" : "Polio");
    await page
      .locator(
        '[data-slot="vaccination-catalog-option"][data-catalog-slug="polio"]',
      )
      .click();
    const lot = `T05-FICTIONAL-${locale}`;
    await page.locator("#vaccination-lot").fill(lot);
    await page.route(
      "**/api/vaccinations",
      async (route) => {
        const response = await route.fetch({ postData: "{}" });
        expect(response.status()).toBe(422);
        await route.fulfill({ response });
      },
      { times: 1 },
    );
    await page.locator('[data-slot="vaccination-save"]').click();
    await expect(page.getByRole("alert")).toContainText(
      chinese
        ? "无法保存疫苗接种记录。"
        : "The vaccination could not be saved.",
    );
    const row = await writeFromUi(page, "/api/vaccinations", () =>
      page.locator('[data-slot="vaccination-save"]').click(),
    );
    try {
      const card = page.locator(`[data-vaccination-id="${row.id}"]`).first();
      await expect(card).toContainText(lot);
      await expect(
        page.locator('[data-slot="vaccination-group"][data-antigen="polio"]'),
      ).toContainText(chinese ? "脊髓灰质炎" : "Polio");
      await screenshot(page, "vaccinations", locale);
    } finally {
      await remove(page, `/api/vaccinations/${row.id}`);
    }
  });
});

test("family history saves fictional free text without translating it", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/settings/anamnesis");
    await page
      .getByRole("button", {
        name: chinese
          ? /^(添加记录|添加首条记录)$/
          : /^(Add entry|Add your first entry)$/,
      })
      .first()
      .click();
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.locator("#family-condition") });
    const condition = `T05 fictional family condition ${locale}`;
    await dialog.locator("#family-condition").fill(condition);
    await dialog.locator("#family-age").fill("55");
    const row = await writeFromUi(page, "/api/family-history", () =>
      dialog
        .getByRole("button", { name: chinese ? "保存" : "Save", exact: true })
        .click(),
    );
    try {
      expect(await read(page, `/api/family-history/${row.id}`)).toMatchObject({
        condition,
        ageAtOnset: 55,
        relationship: "MOTHER",
      });
      await expect(page.locator("#main-content")).toContainText(condition);
      await screenshot(page, "family", locale);
    } finally {
      await remove(page, `/api/family-history/${row.id}`);
    }
  });
});

test("a visit saves with only its existing default date", async ({ page }) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/checkups");
    await page.getByTestId("checkups-tab-visits").click();
    await page.locator('[data-slot="visits-add"]').first().click();
    const save = page.locator('[data-slot="encounter-save"]');
    await expect(save).toHaveText(chinese ? "保存" : "Save");
    await expect(save).toBeEnabled();
    const row = await writeFromUi(page, "/api/encounters", () => save.click());
    try {
      await expect(
        page.locator('[data-slot="visit-card"]').first(),
      ).toBeVisible();
      await screenshot(page, "visits", locale);
    } finally {
      await remove(page, `/api/encounters/${row.id}`);
    }
  });
});

test("mood entries preserve level and note in either language", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/mood");
    await page
      .locator('[data-slot="mood-add-first"], [data-slot="mood-add-entry"]')
      .filter({ visible: true })
      .first()
      .click();
    const dialog = page
      .getByRole("dialog")
      .filter({ has: page.locator('[data-slot="mood-face"]') });
    await dialog.locator('[data-slot="mood-face"][data-mood="GUT"]').click();
    const note = `T05 fictional mood ${locale}`;
    await dialog
      .getByRole("button", { name: chinese ? /备注与详情/ : /Note & details/ })
      .click();
    await dialog.locator("#mood-note").fill(note);
    const stamp = dialog.locator('[data-slot="date-time-field"]');
    const date = stamp.locator('[data-slot="date-field"] input[type="text"]');
    await date.fill(chinese ? "2026/01/15" : "01/15/2026");
    await date.press("Tab");
    const time = stamp.locator('[data-slot="time-field"] input[type="text"]');
    await time.fill(chinese ? "10:02" : "10:01");
    await time.press("Tab");
    const row = await writeFromUi(page, "/api/mood-entries", () =>
      dialog
        .getByRole("button", { name: chinese ? "保存" : "Save", exact: true })
        .click(),
    );
    try {
      expect(await read(page, `/api/mood-entries/${row.id}`)).toMatchObject({
        mood: "GUT",
        note,
      });
      await expect(page.locator("#main-content")).toContainText(note);
      await screenshot(page, "mood", locale);
    } finally {
      await remove(page, `/api/mood-entries/${row.id}`);
    }
  });
});

test("cycle day entries keep their flow and date", async ({ page }) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/cycle");
    const loaded = page.waitForResponse(
      (res) =>
        new URL(res.url()).pathname === "/api/cycle/day-logs" &&
        res.request().method() === "GET",
    );
    await page
      .getByRole("button", {
        name: chinese ? "记录今天" : "Log today",
        exact: true,
      })
      .click();
    const existing = (
      (await (await loaded).json()) as { data: { flow: string | null } | null }
    ).data;
    const dialog = page.getByRole("dialog");
    const light = dialog.getByRole("button", {
      name: chinese ? "量少" : "Light",
      exact: true,
    });
    await expect(light).toHaveAttribute(
      "aria-pressed",
      String(existing?.flow === "LIGHT"),
    );
    if (existing?.flow !== "LIGHT") await light.click();
    const written = page.waitForResponse((res) => {
      const path = new URL(res.url()).pathname;
      return (
        (path === "/api/cycle/day-logs" && res.request().method() === "POST") ||
        (path.startsWith("/api/cycle/day-logs/") &&
          res.request().method() === "PATCH")
      );
    });
    await expect(page.locator('[data-slot="cycle-day-save"]')).toBeEnabled();
    await page.locator('[data-slot="cycle-day-save"]').click();
    const response = await written;
    if (response.request().method() === "PATCH")
      expect(response.status()).toBe(200);
    else expect([200, 201]).toContain(response.status());
    const row = (
      (await response.json()) as { data: { id: string; date: string } }
    ).data;
    try {
      expect(
        await read(page, `/api/cycle/day-logs?date=${row.date}`),
      ).toMatchObject({ id: row.id, date: row.date, flow: "LIGHT" });
      await expect(dialog).toBeHidden();
      await page.reload();
      await expect(
        page.getByRole("heading", {
          name: chinese ? "你的周期" : "Your cycle",
          exact: true,
        }),
      ).toBeVisible();
      await screenshot(page, "cycle", locale);
    } finally {
      await remove(page, `/api/cycle/day-logs/${row.id}`, 204);
    }
  });
});

test("WHO-5 keeps original English questions under Chinese chrome and scores 100", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/mental-wellbeing");
    await page
      .locator(
        '[data-slot="instrument-card"][data-instrument="WHO5"] [data-slot="instrument-card-start"]',
      )
      .click();
    const wizard = page.locator('[data-slot="mental-health-check-in"]');
    if (chinese)
      await expect(
        wizard.locator('[data-slot="check-in-validated-note"]'),
      ).toContainText("英文原文");
    await expect(wizard).toContainText(
      "I have felt cheerful and in good spirits",
    );
    for (let step = 1; step <= 5; step++) {
      await wizard
        .locator(
          `[data-slot="check-in-step"][data-step="${step}"] [role="radio"][data-value="5"]`,
        )
        .click();
    }
    const row = await writeFromUi<{ assessment: { id: string } }>(
      page,
      "/api/mental-health/assessments",
      () => wizard.locator('[data-slot="check-in-submit"]').click(),
    );
    await expect(page.locator('[data-slot="result-score"]')).toContainText(
      "100",
    );
    await expect(
      page.locator('[data-slot="mental-health-result"]'),
    ).toContainText(chinese ? "你的结果" : "Your result");
    expect(
      await read(page, `/api/mental-health/assessments/${row.assessment.id}`),
    ).toMatchObject({ assessment: { totalScore: 100 } });
    await screenshot(page, "mental-health", locale);
  });
});

test("manual hydration remains separate from synced nutrient intake", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    const saved = await page.request.post("/api/nutrients/water", {
      data: { amountMl: 250, mode: "set" },
    });
    expect(saved.status()).toBe(200);
    expect((await saved.json()).data).toMatchObject({
      nutrient: "water",
      source: "MANUAL",
      amount: 250,
      unit: "ml",
    });
    await page.goto("/insights/nutrients");
    await expect(
      page.locator('[data-slot="nutrients-hydration-today"]'),
    ).toContainText("250 ml");
    await expect(page.locator("#main-content")).toContainText(
      chinese ? "维生素与矿物质" : "Vitamins & minerals",
    );
    await screenshot(page, "nutrients", locale);
  });
});

test("a document uploads without AI and keeps its fictional filename", async ({
  page,
}) => {
  await inLanguages(page, async (chinese, locale) => {
    await page.goto("/documents");
    const filename = `T05-fictional-${locale}.pdf`;
    const bytes = Buffer.concat([
      readFileSync(join(__dirname, "../tests/fixtures/pdf/fallback-fonts.pdf")),
      Buffer.from(`\n% T05 ${locale} ${Date.now()}\n`),
    ]);
    const row = await writeFromUi(page, "/api/documents/inbound", () =>
      page
        .locator('[data-slot="document-upload-zone"] input[type="file"]')
        .setInputFiles({
          name: filename,
          mimeType: "application/pdf",
          buffer: bytes,
        }),
    );
    try {
      const card = page.locator(`[data-document-id="${row.id}"]`);
      await expect(card).toContainText(filename);
      await card.locator('[data-slot="document-open"]').click();
      await expect(page.locator("#document-title-input")).toBeVisible();
      await expect(
        page.getByText(chinese ? "标题" : "Title", { exact: true }),
      ).toBeVisible();
      expect(
        await read(page, `/api/documents/inbound/${row.id}`),
      ).toMatchObject({ filename, status: "STORED" });
      await screenshot(page, "documents", locale);
      if (chinese) {
        await page.locator('[data-slot="document-detail-close"]').click();
        await page
          .getByRole("button", { name: "用户菜单", exact: true })
          .click();
        await page.getByRole("menuitem", { name: "主题", exact: true }).hover();
        await page.getByRole("menuitem", { name: "浅色", exact: true }).click();
        await expect(page.locator("html")).toHaveClass(/\blight\b/);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("menu")).toHaveCount(0);
        await screenshot(page, "documents-light", locale);
      }
    } finally {
      await remove(page, `/api/documents/inbound/${row.id}`);
    }
  });
});
