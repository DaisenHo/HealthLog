import { expect, test } from "./setup/test";

import { STORAGE_STATE_PATH } from "./setup/global-setup";

/**
 * Settings navigation at 390 px: one button names the current section and
 * opens a sheet with every section under its group. It replaced a strip of
 * every section as chips, where most of Settings sat off screen.
 */
test.describe("settings navigation on a phone", () => {
  test.use({ storageState: STORAGE_STATE_PATH });

  test("names the section, opens the grouped list and moves on a tap", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/settings/account", { waitUntil: "domcontentloaded" });

    const trigger = page.locator('[data-slot="settings-mobile-nav-trigger"]');
    await expect(trigger).toBeVisible({ timeout: 15_000 });
    await expect(trigger).toContainText("Account");

    // The click can land before hydration; retry until the sheet opens.
    const list = page.locator('[data-slot="settings-mobile-nav-list"]');
    await expect(async () => {
      await trigger.click();
      await expect(list).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    for (const group of ["Account", "Tracking", "Notifications", "System"]) {
      await expect(
        list.getByRole("heading", { name: group, exact: true }),
      ).toBeVisible();
    }

    await list.getByRole("link", { name: "Security" }).click();
    await expect(page).toHaveURL(/\/settings\/security$/);
    await expect(list).toHaveCount(0);
    await expect(trigger).toContainText("Security");

    // Nothing scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
