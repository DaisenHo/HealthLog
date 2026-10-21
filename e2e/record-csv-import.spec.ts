import { expect, test } from "./setup/test";

import { STORAGE_STATE_PATH } from "./setup/global-setup";

/**
 * Lab results from a spreadsheet (#1215), at phone width, against the real
 * server: the mapping is suggested from the headers, the check reports a
 * refused row by line and writes nothing, the import writes the rest, and a
 * second import of the same file only finds duplicates.
 */
function csv(): string {
  const day = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  return [
    "Analyte;Value;Unit;Date",
    `E2E Marker CSV;5,4;mmol/L;${day}`,
    `E2E Marker CSV;1.234;mmol/L;${day}`,
  ].join("\n");
}

test.describe("record CSV import", () => {
  test.use({
    storageState: STORAGE_STATE_PATH,
    viewport: { width: 390, height: 844 },
  });

  test("checks, imports and then only finds duplicates", async ({ page }) => {
    await page.goto("/settings/export");
    await page.locator('[data-slot="record-import-open-labs"]').click();
    const sheet = page.locator('[data-slot="record-import-sheet"]');
    await expect(sheet).toBeVisible();
    const file = {
      name: "labs.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv()),
    };
    await page.locator('[data-slot="record-import-file"]').setInputFiles(file);
    await expect(
      page.locator('[data-slot="record-import-map-analyte"]'),
    ).toHaveValue("0");
    await expect(
      page.locator('[data-slot="record-import-map-value"]'),
    ).toHaveValue("1");

    await page.locator('[data-slot="record-import-check"]').click();
    await expect(
      page.locator('[data-slot="record-import-checked"]'),
    ).toBeVisible();
    await expect(
      page.locator('[data-slot="record-import-error-row"]'),
    ).toHaveCount(1);

    await page.locator('[data-slot="record-import-run"]').click();
    await expect(
      page.locator('[data-slot="record-import-done"]'),
    ).toBeVisible();

    // Second run of the same file.
    await page.keyboard.press("Escape");
    await page.locator('[data-slot="record-import-open-labs"]').click();
    await page.locator('[data-slot="record-import-file"]').setInputFiles(file);
    await page.locator('[data-slot="record-import-check"]').click();
    await expect(
      page.locator('[data-slot="record-import-run"]'),
    ).toBeDisabled();
  });
});
