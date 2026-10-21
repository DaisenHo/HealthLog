import { expect, test } from "./setup/test";

import { STORAGE_STATE_PATH } from "./setup/global-setup";

/**
 * The provenance page (#1204) at phone width, against mocked reads: the
 * day's sources with the used one marked, the comparison table, and the
 * link from Settings > Source priority.
 */
const DAY = {
  type: "ACTIVITY_STEPS",
  date: "2026-10-01",
  aggregation: "sum",
  ranked: true,
  metricKey: "steps",
  ladder: ["APPLE_HEALTH", "FITBIT"],
  picked: "APPLE_HEALTH",
  pickReason: "highest_on_ladder",
  sources: [
    {
      source: "APPLE_HEALTH",
      rank: 0,
      readings: 24,
      value: 9500,
      min: 10,
      max: 900,
      firstAt: "2026-10-01T06:00:00.000Z",
      lastAt: "2026-10-01T20:00:00.000Z",
      unit: "steps",
      devices: ["phone", "watch"],
      pass: null,
    },
    {
      source: "FITBIT",
      rank: 1,
      readings: 1,
      value: 8800,
      min: 8800,
      max: 8800,
      firstAt: "2026-10-01T23:00:00.000Z",
      lastAt: "2026-10-01T23:00:00.000Z",
      unit: "steps",
      devices: ["band"],
      pass: "lower_on_ladder",
    },
  ],
};
const COMPARE = {
  type: "ACTIVITY_STEPS",
  from: "2026-09-02",
  to: "2026-10-01",
  aggregation: "sum",
  ranked: true,
  ladder: ["APPLE_HEALTH", "FITBIT"],
  unit: "steps",
  sources: [
    { source: "APPLE_HEALTH", days: 30 },
    { source: "FITBIT", days: 28 },
  ],
  a: "APPLE_HEALTH",
  b: "FITBIT",
  days: [{ date: "2026-10-01", a: 9500, b: 8800, picked: "APPLE_HEALTH" }],
  summary: {
    daysA: 30,
    daysB: 28,
    daysBoth: 28,
    meanA: 9100,
    meanB: 8700,
    meanDifference: -400,
    meanAbsoluteDifference: 450,
    pickedA: 30,
    pickedB: 0,
  },
};

test.describe("source provenance", () => {
  test.use({
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 390, height: 844 },
  });

  test("explains the day's pick and compares two sources", async ({ page }) => {
    await page.route(/\/api\/measurements\/provenance\/compare/, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: COMPARE, error: null }),
      }),
    );
    await page.route(/\/api\/measurements\/provenance\?/, (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: DAY, error: null }),
      }),
    );
    // Yesterday in UTC: the page refuses nothing, but a day the date field
    // cannot pick (after today) would read as a fixture gone stale.
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/insights/sources?type=ACTIVITY_STEPS&date=${day}`);
    await expect(
      page.locator('[data-slot="provenance-source-row"][data-picked="true"]'),
    ).toHaveAttribute("data-source", "APPLE_HEALTH");
    await expect(
      page.locator('[data-slot="provenance-verdict"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="provenance-compare-row"]'),
    ).toHaveCount(1);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("is reachable from Settings > Source priority", async ({ page }) => {
    await page.goto("/settings/sources");
    await page.locator('[data-slot="sources-provenance-cross-link"]').click();
    await expect(page).toHaveURL(/\/insights\/sources/);
  });
});
