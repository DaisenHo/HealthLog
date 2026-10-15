import { expect, test } from "./setup/test";

import { STORAGE_STATE_PATH } from "./setup/global-setup";

/**
 * `/settings/integrations` on a Pixel-5 viewport (393 CSS px) must:
 *
 *   1. Not produce horizontal page overflow. The badge in each card header is
 *      `whitespace-nowrap`; the header row wraps so the badge drops under the
 *      title when both do not fit. Neither path may leak into a horizontal
 *      scrollbar on the <html> element.
 *
 *   2. Render exactly one status badge per connected card, and none on a card
 *      that is not connected. The Vitest spec covers this on the SSR markup;
 *      the Pixel-5 layout is what matters in practice.
 *
 * Mobile-only spec — desktop project skips it.
 */
test.describe("/settings/integrations Pixel-5 layout", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile-only spec");
  });

  test("Pixel-5 viewport: no horizontal page scroll, one badge per connected card", async ({
    page,
  }) => {
    // Stub the three endpoints the Integrations section reads — both
    // integrations connected, recent sync — so the cards render their
    // post-connect branch (the visually densest layout).
    await page.route("**/api/settings/global-services", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            telegramGlobal: true,
            ntfyGlobal: true,
            webPushGlobal: true,
            apiGlobal: true,
          },
          error: null,
        }),
      }),
    );

    const recent = new Date(Date.now() - 12 * 60 * 1000).toISOString();
    const monthAgo = new Date(
      Date.now() - 28 * 24 * 60 * 60 * 1000,
    ).toISOString();

    await page.route("**/api/integrations/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            threshold: 3,
            integrations: [
              {
                integration: "withings",
                lastError: null,
                configured: true,
                connected: true,
                health: {
                  state: "ok",
                  reason: "data_arriving",
                  since: null,
                  action: null,
                  unavailable: [],
                  lastSuccessAt: recent,
                  lastDataAt: recent,
                  diagnostics: {
                    ledgerState: "connected",
                    failingLegs: [],
                    failingSince: null,
                    lastAttemptAt: recent,
                    verdict: "fresh",
                    recentCalls: [],
                  },
                },
                metricFreshness: [
                  { type: "WEIGHT", lastSeenAt: recent, stale: false },
                ],
              },
              {
                // Configured, card-less, and no longer syncing: the case the
                // fallback row exists for. Synthetic since v1.32.33 — every
                // shipped provider has a card again, and the row must stay
                // proven before the next one is dropped.
                integration: "example-provider",
                lastError: null,
                configured: true,
                connected: true,
                health: {
                  state: "degraded",
                  reason: "sync_stalled",
                  since: monthAgo,
                  action: null,
                  unavailable: [],
                  lastSuccessAt: monthAgo,
                  lastDataAt: monthAgo,
                  diagnostics: {
                    ledgerState: "connected",
                    failingLegs: [],
                    failingSince: null,
                    lastAttemptAt: monthAgo,
                    verdict: "stalled",
                    recentCalls: [],
                  },
                },
                metricFreshness: [],
              },
              // v1.28.x — Strava OAuth card reads off this consolidated
              // envelope; without a `strava` entry the new card's query key
              // never resolves and the integrations page hangs.
              {
                integration: "strava",
                lastError: null,
                connected: false,
                configured: false,
                available: false,
                hasOwnCredentials: false,
                health: null,
                metricFreshness: [],
              },
              // Nightscout reads the envelope too since the card dropped its
              // own status round-trip; without an entry its card never settles.
              {
                integration: "nightscout",
                lastError: null,
                connected: false,
                configured: false,
                hasToken: false,
                health: null,
                metricFreshness: [],
              },
            ],
          },
          error: null,
        }),
      }),
    );

    // Apple Health has delivered nothing on this account: not connected, so
    // no badge. Mocked so a seeded HealthKit row cannot add one.
    await page.route("**/api/integrations/healthkit", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: { entries: [], lastSyncedAt: null, health: null },
          error: null,
        }),
      }),
    );

    await page.route("**/api/withings/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            connected: true,
            configured: true,
            lastSyncedAt: recent,
            connectedAt: "2026-04-01T12:00:00Z",
            tokenExpired: false,
          },
          error: null,
        }),
      }),
    );

    await page.goto("/settings/integrations", {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle");

    // Wait for the cards to settle (queries resolve after first paint).
    // Withings and the card-less fallback are connected: one badge each.
    // Every provider without an envelope entry stays in its loading state,
    // and the not-connected ones carry no badge at all.
    const badges = page.locator('[data-slot="integration-health-badge"]');
    await expect(badges).toHaveCount(2, { timeout: 10_000 });

    // The acceptance case: a configured integration with no card of its own,
    // which has stopped syncing, is visible on the page, read-only.
    const fallback = page.locator(
      '[data-testid="integration-fallback-row"][data-integration="example-provider"]',
    );
    await expect(fallback).toHaveCount(1);
    await expect(
      fallback.locator('[data-slot="integration-health-badge"]'),
    ).toHaveAttribute("data-state", "degraded");
    await expect(
      fallback.locator('[data-slot="integration-menu-trigger"]'),
    ).toHaveCount(0);

    // Card anatomy is uniform because no integration card paints a rule under
    // its header any more.
    await expect(
      page.locator('[data-testid="integration-card-divider"]'),
    ).toHaveCount(0);

    await expect(
      page.locator(
        '[data-slot="integration-card"][data-integration="withings"]',
      ),
    ).toHaveAttribute("data-state", "ok");
    await expect(
      page.locator('[data-slot="integration-card"][data-integration="strava"]'),
    ).toHaveAttribute("data-state", "not_connected");

    // The retired status surfaces stay gone.
    await expect(
      page.locator('[data-testid="integration-status-pill"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="integration-status-banner"]'),
    ).toHaveCount(0);

    // No horizontal page overflow. We allow a 1 px tolerance because
    // sub-pixel rounding can flag a 0.5 px overshoot as 1 px.
    const dims = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(
      dims.scrollWidth,
      `scrollWidth=${dims.scrollWidth}, innerWidth=${dims.innerWidth}`,
    ).toBeLessThanOrEqual(dims.innerWidth + 1);

    // Badge text remains legible at this viewport: painted, not hidden by a
    // surprising container query.
    for (let i = 0; i < 2; i++) {
      const box = await badges.nth(i).boundingBox();
      expect(box, `badge ${i} has no bounding box`).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.height).toBeGreaterThan(0);
    }
  });
});

test.describe("Apple Health guidance", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test("opens on Integrations and reaches the one-shot import fallback", async ({
    page,
  }) => {
    await page.route("**/api/integrations/healthkit", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            entries: [],
            lastSyncedAt: null,
            // Nothing delivered yet: no health, so the card is not connected.
            health: null,
            metricFreshness: [],
            // #778 — nothing accepted yet, so the card must show no
            // progress section for this pending-first-sync account.
            syncProgress: { recordsAccepted: 0, oldestMeasuredAt: null },
          },
          error: null,
        }),
      }),
    );

    await page.goto("/settings/integrations");

    const card = page.getByTestId("apple-health-card");
    await expect(card).toBeVisible();
    // The product name is a proper noun and stays assertable; the sentence
    // around it is not. The description SLOT is the stable target — this spec
    // is about the card rendering its explainer, not about its wording, and
    // the wording is pinned by `apple-health-card.test.tsx` against the same
    // i18n bundle it renders from.
    await expect(card).toContainText("HealthLog iOS app");
    const description = card.locator('[data-slot="settings-card-description"]');
    await expect(description).toBeVisible();
    await expect(description).not.toHaveText("");
    // A raw key means the bundle lookup failed, which is the failure this
    // assertion can actually see from a browser.
    await expect(description).not.toContainText("settings.appleHealth");
    await expect(card).toHaveAttribute("data-state", "not_connected");
    await expect(
      card.locator('[data-slot="integration-health-badge"]'),
    ).toHaveCount(0);

    const importLink = page.getByTestId("apple-health-import-link");
    await expect(importLink).toHaveAttribute(
      "href",
      "/settings/export#settings-section-import-title",
    );
    await page.goto("/settings/export#settings-section-import-title");
    await expect(page).toHaveURL(
      /\/settings\/export#settings-section-import-title$/,
    );
    await expect(page.getByTestId("import-card-apple-health")).toBeVisible();
  });
});
