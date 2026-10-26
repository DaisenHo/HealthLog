import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";
import { unzipSync, strFromU8 } from "fflate";
import { expect, test } from "./setup/test";
import {
  E2E_REPORTS_ADMIN,
  REPORTS_ADMIN_STORAGE_STATE_PATH,
  HEALTH_RECORDS_STORAGE_STATE_PATH,
} from "./setup/global-setup";
import {
  useStaleSession,
  completeReproofWithPassword,
} from "./setup/recent-proof";

test.use({ storageState: REPORTS_ADMIN_STORAGE_STATE_PATH });

async function pdfText(bytes: Uint8Array) {
  const parser = new PDFParse({ data: bytes });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

test("reports, scoped shares and administration stay usable across English and Chinese", async ({
  page,
  browser,
}) => {
  test.slow();
  page.setDefaultTimeout(30_000);
  const cleanupSession = await useStaleSession(
    page,
    E2E_REPORTS_ADMIN.username,
  );
  const me = (await (await page.request.get("/api/auth/me")).json()).data;
  const flags = await (
    await page.request.get("/api/admin/settings/assistant-flags")
  ).json();
  const at = new Date(Date.now() - 86_400_000).toISOString();
  const seeded = await page.request.post("/api/measurements", {
    data: [
      { type: "WEIGHT", value: 72.4, measuredAt: at },
      { type: "BLOOD_PRESSURE_SYS", value: 128, measuredAt: at },
      { type: "BLOOD_PRESSURE_DIA", value: 82, measuredAt: at },
    ],
  });
  expect([201, 409]).toContain(seeded.status());
  const csvHeaders: string[] = [];
  try {
    let first = true;
    for (const locale of ["en", "zh-CN"] as const) {
      const chinese = locale === "zh-CN";
      await page.setViewportSize({ width: chinese ? 390 : 1280, height: 900 });
      await page.goto("/settings/account");
      await page.locator("#language-select").selectOption(locale);
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      await page.goto("/settings/gesundheitsakte");
      const panel = page.getByTestId("health-record-export-panel");
      if (first) await page.getByTestId("report-apply-standard-export").click();
      await page.locator("#hr-range").selectOption("30");
      const formats = panel.getByRole("radio");
      for (const [index, format] of ["pdf", "fhir", "package"].entries()) {
        await formats.nth(index).click();
        const downloaded = page.waitForEvent("download");
        await page.getByTestId("health-record-generate").click();
        if (first) {
          await completeReproofWithPassword(page, E2E_REPORTS_ADMIN.password);
          first = false;
        }
        const file = await downloaded;
        const path = test
          .info()
          .outputPath(
            `t06-${locale}.${format === "package" ? "zip" : format === "fhir" ? "json" : "pdf"}`,
          );
        await file.saveAs(path);
        const bytes = await readFile(path);
        if (format === "pdf") {
          expect(await pdfText(bytes)).toContain(
            chinese ? "健康报告" : "Health Report",
          );
          expect(await pdfText(bytes)).toContain("72.4");
        } else {
          const bundle = JSON.parse(
            format === "fhir"
              ? bytes.toString()
              : strFromU8(unzipSync(bytes)["bundle.json"]),
          );
          expect(bundle.entry[0].resource.title).toBe(
            chinese ? "健康报告" : "Health Record",
          );
          if (format === "package")
            expect(await pdfText(unzipSync(bytes)["report.pdf"])).toContain(
              chinese ? "健康报告" : "Health Report",
            );
        }
      }
      await page.screenshot({
        path: test.info().outputPath(`t06-report-${locale}.png`),
        fullPage: true,
      });
      for (const section of ["general", "coach", "integrations"] as const) {
        await page.goto(`/admin/${section}`);
        await expect(page.locator("main")).toBeVisible();
        await expect(page.locator("main")).toContainText(
          (chinese
            ? { general: "常规", coach: "Coach", integrations: "集成" }
            : {
                general: "General",
                coach: "Coach",
                integrations: "Integrations",
              })[section],
        );
        await page.screenshot({
          path: test.info().outputPath(`t06-admin-${section}-${locale}.png`),
          fullPage: true,
        });
      }
      await page.goto("/settings/export");
      const csvDownload = page.waitForEvent("download");
      await page.getByTestId("export-action-measurements-csv").click();
      const csvFile = await csvDownload;
      const csvPath = test.info().outputPath(`t06-measurements-${locale}.csv`);
      await csvFile.saveAs(csvPath);
      const csv = await readFile(csvPath, "utf8");
      csvHeaders.push(csv.split(/\r?\n/)[0]);
      expect(csv).toContain("WEIGHT,72.4,kg");
      await page.locator('[data-slot="command-palette-trigger"]').click();
      const palette = page.getByRole("dialog");
      await expect(palette).toBeVisible();
      await palette
        .getByRole("combobox")
        .fill(chinese ? "虚构不存在导航项" : "fictional-missing-navigation");
      await page.keyboard.press("Escape");
      await expect(palette).not.toBeVisible();
      const after = (await (await page.request.get("/api/auth/me")).json())
        .data;
      expect(after).toMatchObject({
        locale,
        timezone: me.timezone,
        unitPreference: me.unitPreference,
      });
    }
    expect(csvHeaders[1]).toBe(csvHeaders[0]);
    expect(
      await (
        await page.request.get("/api/admin/settings/assistant-flags")
      ).json(),
    ).toEqual(flags);
    const baseURL = new URL(page.url()).origin;
    const denied = await browser.newContext({
      baseURL,
      storageState: HEALTH_RECORDS_STORAGE_STATE_PATH,
    });
    try {
      expect((await denied.request.get("/api/admin/settings")).status()).toBe(
        403,
      );
    } finally {
      await denied.close();
    }

    await page.goto("/admin/reminders");
    await page.getByRole("button", { name: "发送测试", exact: true }).click();
    await expect(
      page.getByText("未找到已启用的通知渠道", { exact: true }),
    ).toBeVisible();
    // Keep this dispatch-capable check scoped to the synthetic account.
    await page.route("**/api/admin/notifications/reminder-check", (route) =>
      route.continue({
        postData: JSON.stringify({ userId: me.id }),
        headers: {
          ...route.request().headers(),
          "content-type": "application/json",
        },
      }),
    );
    const medication = await page.request.post("/api/medications", {
      data: {
        name: "T06 虚构药品",
        dose: "5 mg",
        notificationsEnabled: false,
        schedules: [
          {
            windowStart: "22:00",
            windowEnd: "23:59",
            timesOfDay: ["22:00"],
            rrule: "FREQ=DAILY",
          },
        ],
      },
    });
    expect(medication.status()).toBe(201);
    const medicationId = (await medication.json()).data.id;
    try {
      const checked = page.waitForResponse((r) =>
        r.url().endsWith("/api/admin/notifications/reminder-check"),
      );
      await page
        .getByRole("button", { name: "运行提醒检查", exact: true })
        .click();
      const results = (await (await checked).json()).data;
      expect(results.message).toBe("已检查 1 种药品，发送 0 条通知");
      expect(results.medications[0]).toMatchObject({
        name: "T06 虚构药品",
        dose: "5 mg",
        notificationsEnabled: false,
        timezone: me.timezone,
      });
      expect(results.medications[0].dayOfWeek).toMatch(/^周/);
      expect(results.medications[0].schedules[0]).toMatchObject({
        window: "22:00–23:59",
        days: "每天",
        status: "open",
        label: "时间窗尚未结束（23:59 结束）",
        notificationSent: false,
      });
      await expect(
        page.getByText("已检查 1 种药品，发送 0 条通知", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("时间窗尚未结束（23:59 结束）", { exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath("t06-admin-reminders-zh-CN.png"),
        fullPage: true,
      });
    } finally {
      expect(
        (
          await page.request.delete(`/api/medications/${medicationId}`)
        ).status(),
      ).toBe(200);
    }
    await page.goto("/settings/gesundheitsakte#sharing");
    await page.locator("#share-label").fill("T06 虚构只读分享");
    await page.getByTestId("report-apply-standard-share").click();
    const created = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === "/api/share-links" &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "创建链接", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    const share = (await response.json()).data;
    const visitor = await browser.newContext({ baseURL });
    try {
      const token = share.token;
      expect((await visitor.request.get(`/c/${token}/fhir`)).status()).toBe(
        404,
      );
      const guest = await visitor.newPage();
      await guest.setViewportSize({ width: 390, height: 900 });
      await visitor.addCookies([
        { name: "healthlog-locale", value: "zh-CN", url: baseURL },
      ]);
      await guest.goto(`/c/${token}`);
      await expect(guest.locator("#share-passphrase")).toBeVisible();
      await guest.locator("#share-passphrase").fill(share.passphrase);
      const unlocked = guest.waitForResponse((r) =>
        r.url().endsWith(`/api/c/${token}/unlock`),
      );
      await guest.locator('form button[type="submit"]').click();
      expect((await unlocked).status()).toBe(200);
      await expect(guest.locator("#share-passphrase")).not.toBeAttached();
      await expect(guest.locator("html")).toHaveAttribute("lang", "zh-CN");
      const publicBundle = await visitor.request.get(`/c/${token}/fhir`);
      expect(publicBundle.status()).toBe(200);
      expect((await publicBundle.json()).entry[0].resource.title).toBe(
        "健康报告",
      );
      const publicPdf = await visitor.request.get(`/c/${token}/report.pdf`);
      expect(publicPdf.status()).toBe(200);
      expect(await pdfText(await publicPdf.body())).toContain("健康报告");
      await expect(
        guest.getByRole("heading", { name: "共享健康记录", exact: true }),
      ).toBeVisible();
      await expect(
        guest.getByText("收缩压", { exact: true }).first(),
      ).toBeVisible();
      await guest.screenshot({
        path: test.info().outputPath("t06-share-zh-CN.png"),
        fullPage: true,
      });
      await visitor.addCookies([
        { name: "healthlog-locale", value: "en", url: baseURL },
      ]);
      expect(
        (await (await visitor.request.get(`/c/${token}/fhir`)).json()).entry[0]
          .resource.title,
      ).toBe("Health Record");
    } finally {
      await visitor.close();
      await page.request.delete(`/api/share-links/${share.id}`);
    }
  } finally {
    await page.request.put("/api/auth/me/locale", {
      data: { locale: me.locale },
    });
    await cleanupSession();
  }
});
