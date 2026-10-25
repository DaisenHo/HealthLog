import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getServerTranslator } from "../server-translator";
import {
  lazyServerCatalogs,
  loadedServerLocales,
  serverCatalog,
} from "../server-catalogs";

describe("server catalogs", () => {
  it("reads a locale from messages/ on first use and keeps one copy", () => {
    const de = serverCatalog("de");
    expect(de).toEqual(
      JSON.parse(
        readFileSync(join(process.cwd(), "messages", "de.json"), "utf8"),
      ),
    );
    expect(serverCatalog("de")).toBe(de);
    expect(loadedServerLocales()).toContain("de");
  });

  it("loads only the locale an entry of the lazy record is read for", () => {
    const record = lazyServerCatalogs();
    const before = new Set(loadedServerLocales());
    void record.it;
    const added = loadedServerLocales().filter((l) => !before.has(l));
    expect(added.every((l) => l === "it")).toBe(true);
    expect(record.it).toBe(serverCatalog("it"));
  });

  it("lets an assignment replace an entry", () => {
    const record = lazyServerCatalogs();
    record.ko = { common: { save: "x" } };
    expect(record.ko).toEqual({ common: { save: "x" } });
    expect(serverCatalog("ko")).not.toEqual({ common: { save: "x" } });
  });

  it("refuses a locale that is not shipped", () => {
    expect(() => serverCatalog("xx" as "de")).toThrow(/unknown locale/);
  });

  it("serves the server translator from the same catalogs", () => {
    const t = getServerTranslator("fr");
    const fr = serverCatalog("fr") as { common: { save: string } };
    expect(t.t("common.save")).toBe(fr.common.save);
  });
  it("formats Chinese reminder text without translating the medication or dose", () => {
    const { t } = getServerTranslator("zh-CN");
    expect(
      t("medicationReminders.phaseYellowMessage", {
        medName: "Fictional Capsule",
        doseInfo: "500 mg",
        timeWindow: "08:00–09:00",
        minutes: 12,
      }),
    ).toBe(
      "🟡 即将到期：\n<b>Fictional Capsule</b>（500 mg，08:00–09:00）\n还剩 12 分钟。",
    );
    expect(t("lowStockReminders.title", { medName: "Fictional Capsule" })).toBe(
      "库存不足：Fictional Capsule",
    );
  });
});
