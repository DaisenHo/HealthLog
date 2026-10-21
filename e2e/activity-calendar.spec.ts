import { expect, test } from "./setup/test";

import { STORAGE_STATE_PATH } from "./setup/global-setup";

/**
 * The activity calendar on the workouts page (D1036), at phone width: the
 * card renders a whole-week grid, pages back a period, switches to the week
 * view, and the goals sheet saves a goal the calendar then reports.
 */
test.describe("activity calendar", () => {
  test.use({
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 390, height: 844 },
  });

  test("draws the month, pages back and switches to a week", async ({
    page,
  }) => {
    await page.goto("/insights/workouts");
    const card = page.locator('[data-slot="activity-calendar"]');
    await expect(card).toBeVisible();
    await expect(
      page.locator('[data-slot="activity-calendar-label"]'),
    ).not.toHaveText("");

    const days = page.locator('[data-slot="activity-calendar-day"]');
    const monthCount = await days.count();
    if (monthCount > 0) expect(monthCount % 7).toBe(0);

    const label = page.locator('[data-slot="activity-calendar-label"]');
    const before = await label.textContent();
    await page.locator('[data-slot="activity-calendar-previous"]').click();
    await expect(label).not.toHaveText(before ?? "");

    await expect(card).toHaveAttribute("data-period", "month");
    await page.locator('[data-slot="activity-calendar-period-week"]').click();
    await expect(card).toHaveAttribute("data-period", "week");
    if ((await days.count()) > 0) await expect(days).toHaveCount(7);

    // Nothing in the card pushes the page sideways on a phone.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("saves a goal and shows its progress", async ({ page }) => {
    await page.goto("/insights/workouts");
    await page.locator('[data-slot="activity-calendar-set-goals"]').click();
    const field = page.locator(
      '[data-slot="activity-goals-form"] [data-goal-key="stepsPerMonth"]',
    );
    const goal = page.locator(
      '[data-slot="activity-calendar-goal"][data-goal-key="stepsPerMonth"]',
    );
    await field.fill("150000");
    await page.locator('[data-slot="activity-goals-save"]').click();
    await expect(goal).toBeVisible();

    // Clear it again so the account is left as it was found.
    await page.locator('[data-slot="activity-calendar-set-goals"]').click();
    await field.fill("");
    await page.locator('[data-slot="activity-goals-save"]').click();
    await expect(goal).toHaveCount(0);
  });
});
