import { describe, expect, it } from "vitest";

import { parseCsvDate, parseLocaleNumber, parseYesNo } from "../csv-values";

describe("parseLocaleNumber", () => {
  it.each([
    ["5.4", "dot", 5.4],
    ["5,4", "comma", 5.4],
    ["-0.5", "dot", -0.5],
    ["1,234.5", "dot", 1234.5],
    ["1.234,5", "comma", 1234.5],
    ["1,234,567", "dot", 1234567],
    ["1.234.567", "comma", 1234567],
    ["5,4", "dot", 5.4],
    ["5.4", "comma", 5.4],
    ["12", "comma", 12],
    [" 7,25 ", "comma", 7.25],
    ["1 234,5", "comma", 1234.5],
    [".5", "dot", 0.5],
  ] as const)("%j (%s) → %s", (raw, mark, value) => {
    expect(parseLocaleNumber(raw, mark)).toEqual({ ok: true, value });
  });

  it.each([
    ["1,234", "dot"],
    ["1.234", "comma"],
    ["1234,567", "dot"],
  ] as const)("refuses %j (%s) as ambiguous", (raw, mark) => {
    expect(parseLocaleNumber(raw, mark)).toEqual({
      ok: false,
      reason: "ambiguous_number",
    });
  });

  it.each(["", "abc", "<0.5", "5..4", "1,2,3", "5.4.3", "1e5", "5,"])(
    "refuses %j as not a number",
    (raw) => {
      expect(parseLocaleNumber(raw, "dot").ok).toBe(false);
    },
  );
});

describe("parseCsvDate", () => {
  const berlin = { timezone: "Europe/Berlin" };

  it("stores a date without a time on the date-only anchor", () => {
    const r = parseCsvDate("2024-02-01", undefined, {
      order: "iso",
      ...berlin,
    });
    expect(r).toMatchObject({
      ok: true,
      dateKey: "2024-02-01",
      dateOnly: true,
    });
    expect(r.ok && r.instant.toISOString()).toBe("2024-02-01T12:00:00.000Z");
  });

  it("reads a wall-clock time in the import's zone, across DST", () => {
    const winter = parseCsvDate("15.01.2024", "08:30", {
      order: "dmy",
      ...berlin,
    });
    const summer = parseCsvDate("15.07.2024 08:30", undefined, {
      order: "dmy",
      ...berlin,
    });
    expect(winter.ok && winter.instant.toISOString()).toBe(
      "2024-01-15T07:30:00.000Z",
    );
    expect(summer.ok && summer.instant.toISOString()).toBe(
      "2024-07-15T06:30:00.000Z",
    );
  });

  it("honours an explicit offset over the zone", () => {
    const r = parseCsvDate("2024-07-15T08:30:00+02:00", undefined, {
      order: "iso",
      timezone: "America/New_York",
    });
    expect(r.ok && r.instant.toISOString()).toBe("2024-07-15T06:30:00.000Z");
  });

  it("reads US order and refuses a cell that cannot be in it", () => {
    expect(
      parseCsvDate("02/15/2024", undefined, { order: "mdy", ...berlin }),
    ).toMatchObject({ ok: true, dateKey: "2024-02-15" });
    expect(
      parseCsvDate("15/02/2024", undefined, { order: "mdy", ...berlin }),
    ).toEqual({ ok: false, reason: "ambiguous_date" });
  });

  it.each([
    ["31.02.2024", "dmy", "invalid_date"],
    ["01.02.24", "dmy", "ambiguous_date"],
    ["24-02-01", "iso", "ambiguous_date"],
    ["Feb 1 2024", "iso", "invalid_date"],
    ["", "iso", "invalid_date"],
  ] as const)("%j (%s) → %s", (raw, order, reason) => {
    expect(parseCsvDate(raw, undefined, { order, ...berlin })).toEqual({
      ok: false,
      reason,
    });
  });

  it("refuses an impossible time", () => {
    expect(
      parseCsvDate("2024-02-01", "25:00", { order: "iso", ...berlin }),
    ).toEqual({ ok: false, reason: "invalid_time" });
  });
});

describe("parseYesNo", () => {
  it("reads the usual spellings and nothing else", () => {
    expect(parseYesNo("Ja")).toBe(true);
    expect(parseYesNo("no")).toBe(false);
    expect(parseYesNo("")).toBeNull();
    expect(parseYesNo("maybe")).toBeNull();
  });
});
