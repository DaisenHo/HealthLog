import type { Page } from "@playwright/test";

import { expect, test } from "./setup/test";
import { TOPICS_STORAGE_STATE_PATH } from "./setup/global-setup";
import { expectNoHorizontalOverflow } from "./utils/horizontal-overflow";

/**
 * The Topics preview end to end, on its own account (`E2E_TOPICS`, seeded by
 * `topics-fixture.ts`):
 *
 *  - switched off (every account's start): no More tile, no sidebar entry,
 *    the pages leave for Insights and the routes answer 404;
 *  - switched on in Settings > System > Preview features: the More sheet
 *    leads with a Topics tile carrying the Beta badge, the desktop sidebar
 *    has the entry directly below Insights;
 *  - every offered topic renders from the seeded record, with the relationship
 *    that has fourteen paired days stated and the ones short of it saying how
 *    far they are, the lab trend drawn for the marker with three readings over
 *    a year and named as missing for the one with a single reading.
 *
 * Phone project only, in one serial run: the switch is account-wide, so two
 * projects toggling it at once would read each other's state.
 */
test.describe.configure({ mode: "serial" });

async function setPreview(page: Page, topics: boolean) {
  const res = await page.request.patch("/api/settings/preview-features", {
    data: { topics },
  });
  expect(res.ok(), `preview PATCH answered ${res.status()}`).toBe(true);
}

async function openMoreSheet(page: Page) {
  await page.locator('[data-testid="bottom-nav-more"]').click();
  const sheet = page.locator('[data-testid="bottom-nav-more-sheet"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe("Topics (preview)", () => {
  test.use({
    storageState: TOPICS_STORAGE_STATE_PATH,
    viewport: { width: 390, height: 844 },
  });

  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "phone journey");
  });

  test.afterAll(async ({ browser }, testInfo) => {
    if (testInfo.project.name !== "chromium-mobile") return;
    const context = await browser.newContext({
      storageState: TOPICS_STORAGE_STATE_PATH,
      baseURL: testInfo.project.use.baseURL,
    });
    // Leave the account as every account starts: the preview off.
    await context.request.patch("/api/settings/preview-features", {
      data: { topics: false },
    });
    await context.close();
  });

  test("switched off: no tile, no entry, the pages leave and the routes refuse", async ({
    page,
  }) => {
    await setPreview(page, false);
    await page.goto("/");
    const sheet = await openMoreSheet(page);
    await expect(sheet.locator('a[href="/topics"]')).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.goto("/topics");
    await page.waitForURL(/\/insights$/);
    await page.goto("/topics/heart");
    await page.waitForURL(/\/insights$/);

    const api = await page.request.get("/api/topics");
    expect(api.status()).toBe(404);
    expect(
      ((await api.json()) as { meta?: { errorCode?: string } }).meta,
    ).toMatchObject({ errorCode: "topics.preview_off" });
  });

  test("switched on in Settings: the More sheet leads with the Topics tile", async ({
    page,
  }) => {
    await setPreview(page, false);
    await page.goto("/settings/preview");
    const toggle = page.locator('[data-slot="settings-preview-topics-switch"]');
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(
      page.locator('[data-slot="settings-preview-topics-open"]'),
    ).toBeVisible();

    const sheet = await openMoreSheet(page);
    const tiles = sheet.locator("a");
    await expect(tiles.first()).toHaveAttribute("href", "/topics");
    await expect(
      tiles.first().locator('[data-slot="preview-badge"]'),
    ).toBeVisible();
    await tiles.first().click();
    await page.waitForURL(/\/topics$/);
    await expect(page.locator('[data-slot="topics-grid"]')).toBeVisible();
  });

  test("every offered topic renders from the record, below-threshold states included", async ({
    page,
  }) => {
    await setPreview(page, true);
    await page.goto("/topics");
    const grid = page.locator('[data-slot="topics-grid"]');
    await expect(grid).toBeVisible();
    for (const key of [
      "heart",
      "body",
      "blood-pressure",
      "sleep",
      "activity",
      "metabolism",
      "mind",
    ]) {
      await expect(
        grid.locator(`[data-slot="topic-tile"][data-topic="${key}"]`),
      ).toBeVisible();
    }
    // No cycle module for this account: named once, never a tile.
    await expect(
      grid.locator('[data-slot="topic-tile"][data-topic="cycle"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-slot="topics-hidden-list"]'),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page, "/topics");

    // The heart: the pair with 40 paired days speaks, the steps pair cannot.
    await grid
      .locator('[data-topic="heart"] [data-slot="topic-tile-link"]')
      .click();
    await page.waitForURL(/\/topics\/heart$/);
    const body = page.locator('[data-slot="topic-detail-body"]');
    await expect(body).toBeVisible();
    await expect(
      body.locator(
        '[data-slot="topic-relationship"][data-relationship="hrv-resting-hr"]',
      ),
    ).toHaveAttribute("data-status", "linked");
    await expect(
      body.locator(
        '[data-slot="topic-signal"][data-signal="RESTING_HEART_RATE"]',
      ),
    ).toBeVisible();
    await expect(
      body.locator('[data-slot="topic-chart-row"]').first(),
    ).toBeVisible();
    await expect(body.locator('[data-slot="topic-missing"]')).toBeVisible();
    await expectNoHorizontalOverflow(page, "/topics/heart");

    // The range switch re-reads the window.
    await page
      .locator('[data-slot="topic-range"]')
      .getByRole("radio", { name: /90/ })
      .click();
    await expect(body).toBeVisible();

    await page.goto("/topics/activity");
    await expect(
      page.locator(
        '[data-slot="topic-relationship"][data-relationship="steps-sleep"]',
      ),
    ).toHaveAttribute("data-status", "insufficient");

    await page.goto("/topics/mind");
    await expect(
      page.locator(
        '[data-slot="topic-relationship"][data-relationship="short-nights-mood"]',
      ),
    ).toHaveAttribute("data-status", "insufficient");

    await page.goto("/topics/metabolism");
    const labs = page.locator('[data-slot="topic-labs"]');
    await expect(labs).toBeVisible();
    await expect(labs.locator('[data-slot="topic-lab-trend"]')).toHaveCount(1);
    await expect(
      labs.locator('[data-slot="topic-lab-trend-short"]'),
    ).toBeVisible();
    await expect(
      labs.locator('[data-slot="topic-lab-marker"][data-status="below"]'),
    ).toHaveCount(1);
    await expectNoHorizontalOverflow(page, "/topics/metabolism");

    for (const key of ["body", "blood-pressure", "sleep"]) {
      await page.goto(`/topics/${key}`);
      await expect(
        page.locator('[data-slot="topic-detail-body"]'),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, `/topics/${key}`);
    }
  });

  test("the desktop sidebar carries the entry directly below Insights", async ({
    page,
  }) => {
    await setPreview(page, true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/topics");
    const nav = page.locator('[data-slot="sidebar-column"] nav');
    const links = nav.locator("a");
    await expect(nav.locator('a[href="/topics"]')).toBeVisible();
    const hrefs = await links.evaluateAll((els) =>
      els.map((el) => el.getAttribute("href")),
    );
    expect(hrefs[hrefs.indexOf("/insights") + 1]).toBe("/topics");
    await expect(
      nav.locator('a[href="/topics"] [data-slot="preview-badge"]'),
    ).toBeVisible();
  });
});
