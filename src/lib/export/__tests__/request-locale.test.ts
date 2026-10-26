import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { resolveExportLocale } from "../request-locale";

describe("export reader language", () => {
  const request = new NextRequest("http://localhost/api/export/health-record", {
    headers: { cookie: "healthlog-locale=de", "accept-language": "fr" },
  });
  it("uses the explicit choice before the requesting account", () => {
    expect(resolveExportLocale("en", "zh-CN", request)).toBe("en");
  });
  it("uses the account before stale browser hints", () => {
    expect(resolveExportLocale(undefined, "zh-CN", request)).toBe("zh-CN");
  });
  it("preserves legacy hints for accounts without a valid language", () => {
    expect(resolveExportLocale(undefined, null, request)).toBe("de");
  });
});
