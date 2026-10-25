import { expect, test } from "./setup/test";
import { HEALTH_RECORDS_STORAGE_STATE_PATH } from "./setup/global-setup";

test.use({ storageState: HEALTH_RECORDS_STORAGE_STATE_PATH });

test("the same weight journey works in English and Simplified Chinese", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(30_000);
  const before = (await (await context.request.get("/api/auth/me")).json())
    .data;
  const ids: string[] = [];
  const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  try {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const locale of ["en", "zh-CN"] as const) {
        const chinese = locale === "zh-CN";
        await page.goto("/settings/account");
        await page.locator("#language-select").selectOption(locale);
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await page.goto("/");
        await expect(
          page.getByRole("heading", {
            name: chinese ? "健康概览" : "Dashboard",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page
            .getByRole("button", {
              name: chinese ? "添加" : "Add",
              exact: true,
            })
            .first(),
        ).toBeVisible();
        await page.goto("/measurements?add=WEIGHT");
        const dialog = page
          .getByRole("dialog")
          .filter({ has: page.locator("#value") });
        await expect(dialog).toBeVisible();
        if (chinese) {
          await dialog.locator("#value").fill("-1");
          const rejected = page.waitForResponse(
            (response) =>
              response.url().endsWith("/api/measurements") &&
              response.request().method() === "POST",
          );
          await dialog
            .getByRole("button", { name: "保存", exact: true })
            .click();
          expect((await rejected).status()).toBe(422);
          await expect(dialog.getByRole("alert")).toContainText(
            "请检查测量记录的内容后重试。",
          );
        }
        await dialog.locator("#value").fill("78.4");
        const date = dialog
          .locator('[data-slot="date-time-field"] input[type="text"]')
          .first();
        const [year, month, dateOfMonth] = day.split("-");
        const display = chinese
          ? `${year}/${month}/${dateOfMonth}`
          : `${month}/${dateOfMonth}/${year}`;
        await date.fill(display);
        await date.press("Tab");
        await expect(dialog.locator("#measuredAt")).toHaveValue(day);
        await dialog
          .getByRole("button", {
            name: chinese ? "选择日期" : "Open date picker",
            exact: true,
          })
          .click();
        const calendar = page.locator('[data-slot="calendar"]');
        await expect(calendar).toBeVisible();
        await expect(calendar).toContainText(chinese ? "一" : "Mo");
        await page.keyboard.press("Escape");
        const time = dialog.locator(
          '[data-slot="time-field"] input[type="text"]',
        );
        const hour = viewport.width === 390 ? "11" : "10";
        await time.fill(chinese ? `${hour}:02` : `${hour}:01 AM`);
        await time.press("Tab");
        await dialog
          .locator("#notes")
          .fill(`T03 synthetic ${locale} ${viewport.width}`);
        const saved = page.waitForResponse(
          (response) =>
            response.url().endsWith("/api/measurements") &&
            response.request().method() === "POST",
        );
        await dialog
          .getByRole("button", { name: chinese ? "保存" : "Save", exact: true })
          .click();
        const response = await saved;
        expect(response.status()).toBe(201);
        const row = (await response.json()).data;
        ids.push(row.id);
        expect(row).toMatchObject({ type: "WEIGHT", value: 78.4, unit: "kg" });
        await expect(dialog).toBeHidden();
        await expect(page.locator("main")).toContainText(
          `T03 synthetic ${locale} ${viewport.width}`,
        );
        await page.goto("/insights/weight");
        await expect(
          page
            .getByRole("heading", {
              name: chinese ? "体重" : "Weight",
              exact: true,
            })
            .first(),
        ).toBeVisible();
        await page
          .getByRole("button", { name: chinese ? "全部" : "All", exact: true })
          .first()
          .click();
        await expect(page.locator("main")).toContainText("78.4");
        if (chinese) {
          await expect(
            page.getByText("正常", { exact: true }).first(),
          ).toBeVisible();
          await expect(page.locator("main")).toContainText("来源：WHO BMI");
        }
        const table = page
          .locator('[data-slot="chart-data-table-toggle"]')
          .first();
        await expect(table).toContainText(chinese ? "数据点" : "Data points");
        await table.click();
        await expect(
          page.locator('[data-slot="chart-data-table-region"]').first(),
        ).toBeVisible();
        await page.screenshot({
          path: test
            .info()
            .outputPath(`weight-${locale}-${viewport.width}.png`),
          fullPage: true,
        });
        await page.reload();
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        await page.goto("/timeline");
        await expect(
          page.getByRole("heading", {
            name: chinese ? "时间线" : "Timeline",
            exact: true,
          }),
        ).toBeVisible();
        await expect(page.locator('[data-slot="timeline-page"]')).toBeVisible();
        await expect(
          page.locator('[data-slot="timeline-loading"]'),
        ).toBeHidden();
        await expect(
          page.locator(
            `[data-slot="timeline-${viewport.width === 390 ? "mobile" : "desktop"}"]`,
          ),
        ).toBeVisible();
        await expect(page.locator("main")).toContainText(
          chinese ? "体重" : "Weight",
        );
        await page.screenshot({
          path: test
            .info()
            .outputPath(`timeline-${locale}-${viewport.width}.png`),
          fullPage: true,
        });
      }
    }
    const after = (await (await context.request.get("/api/auth/me")).json())
      .data;
    expect(after).toMatchObject({
      unitPreference: before.unitPreference,
      timezone: before.timezone,
      dateFormat: before.dateFormat,
      timeFormat: before.timeFormat,
    });
  } finally {
    for (const id of ids)
      await context.request.delete(`/api/measurements/${id}`);
    await context.request.put("/api/auth/me/locale", {
      data: { locale: before.locale ?? "en" },
    });
  }
});
