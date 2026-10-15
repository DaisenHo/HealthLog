import { describe, expect, it } from "vitest";

import { travelRuns } from "../travel";
import { distanceInUnit } from "../movement";

describe("travelRuns", () => {
  it("groups consecutive days in one country and splits on a gap or a border", () => {
    expect(
      travelRuns([
        { date: "2026-06-16", countryCode: "ES" },
        { date: "2026-06-15", countryCode: "ES" },
        { date: "2026-06-17", countryCode: "FR" },
        { date: "2026-06-20", countryCode: "FR" },
      ]),
    ).toEqual([
      {
        id: "2026-06-15_2026-06-16_ES",
        startDate: "2026-06-15",
        endDate: "2026-06-16",
        countryCode: "ES",
      },
      {
        id: "2026-06-17_2026-06-17_FR",
        startDate: "2026-06-17",
        endDate: "2026-06-17",
        countryCode: "FR",
      },
      {
        id: "2026-06-20_2026-06-20_FR",
        startDate: "2026-06-20",
        endDate: "2026-06-20",
        countryCode: "FR",
      },
    ]);
  });
});

describe("distanceInUnit", () => {
  it("answers one decimal in the account's unit", () => {
    expect(distanceInUnit(48_300, "km")).toBe(48.3);
    expect(distanceInUnit(16_093, "mi")).toBe(10);
    expect(distanceInUnit(null, "km")).toBeNull();
  });
});
