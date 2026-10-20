import { describe, it, expect } from "vitest";

import { getNumberFormat, getDateTimeFormat } from "../formatter-cache";

describe("formatter-cache", () => {
  it("returns the same NumberFormat instance for identical (locale, options)", () => {
    const a = getNumberFormat("en", { maximumFractionDigits: 2 });
    const b = getNumberFormat("en", { maximumFractionDigits: 2 });
    expect(a).toBe(b);
  });

  it("returns distinct NumberFormat instances for different options", () => {
    const a = getNumberFormat("en", { maximumFractionDigits: 2 });
    const b = getNumberFormat("en", { maximumFractionDigits: 0 });
    expect(a).not.toBe(b);
  });

  it("returns distinct instances per locale", () => {
    const a = getNumberFormat("en", { maximumFractionDigits: 1 });
    const b = getNumberFormat("de", { maximumFractionDigits: 1 });
    expect(a).not.toBe(b);
  });

  it("caches DateTimeFormat and still formats correctly", () => {
    const a = getDateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const b = getDateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    expect(a).toBe(b);
    expect(a.format(new Date("2026-05-08T12:00:00Z"))).toBe("2026-05-08");
  });

  // v1.28.42 — `makeFormatters` routes every date/time closure through
  // this cache, so the memo key MUST distinguish the two variables that make
  // otherwise-identical shapes render differently: the profile timezone and
  // the hour-cycle option. A collision on either would render the wrong wall
  // clock / wrong local day.
  it("keys DateTimeFormat by timeZone (no cross-tz collision)", () => {
    const opts = { hour: "2-digit", minute: "2-digit" } as const;
    const berlin = getDateTimeFormat("en-US", {
      ...opts,
      timeZone: "Europe/Berlin",
    });
    const tokyo = getDateTimeFormat("en-US", {
      ...opts,
      timeZone: "Asia/Tokyo",
    });
    expect(berlin).not.toBe(tokyo);
    // 14:30 UTC → 16:30 Berlin (CEST) vs 23:30 Tokyo.
    const sample = new Date("2026-04-18T14:30:00Z");
    expect(berlin.format(sample)).not.toBe(tokyo.format(sample));
  });

  it("keys DateTimeFormat by hour-cycle option", () => {
    const base = {
      timeZone: "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
    } as const;
    const auto = getDateTimeFormat("en-US", base);
    const h24 = getDateTimeFormat("en-US", { ...base, hourCycle: "h23" });
    expect(auto).not.toBe(h24);
  });
});
