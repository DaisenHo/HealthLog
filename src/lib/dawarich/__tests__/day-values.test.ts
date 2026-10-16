import { describe, expect, it } from "vitest";

import {
  awayFromHomeMinutes,
  buildDayValues,
  mostFrequentCountry,
  travelDay,
} from "../day-values";

const at = (iso: string) => Date.parse(iso);
const HOME = 7;
// 2026-06-15 in Europe/Berlin is 22:00Z on the 14th to 22:00Z on the 15th.
const dayStart = new Date("2026-06-14T22:00:00Z");
const dayEnd = new Date("2026-06-15T22:00:00Z");

describe("awayFromHomeMinutes", () => {
  it("subtracts the minutes the home visits cover inside the day", () => {
    const visits = [
      {
        placeId: HOME,
        startMs: at("2026-06-14T18:00:00Z"),
        endMs: at("2026-06-15T06:00:00Z"),
      },
      {
        placeId: 9,
        startMs: at("2026-06-15T07:00:00Z"),
        endMs: at("2026-06-15T15:00:00Z"),
      },
      {
        placeId: HOME,
        startMs: at("2026-06-15T16:00:00Z"),
        endMs: at("2026-06-16T05:00:00Z"),
      },
    ];
    // 8 h + 6 h at home out of 24 h.
    expect(awayFromHomeMinutes(visits, dayStart, dayEnd, HOME)).toBe(600);
  });

  it("counts overlapping home visits once", () => {
    const visits = [
      {
        placeId: HOME,
        startMs: at("2026-06-15T00:00:00Z"),
        endMs: at("2026-06-15T10:00:00Z"),
      },
      {
        placeId: HOME,
        startMs: at("2026-06-15T05:00:00Z"),
        endMs: at("2026-06-15T12:00:00Z"),
      },
    ];
    expect(awayFromHomeMinutes(visits, dayStart, dayEnd, HOME)).toBe(
      1440 - 12 * 60,
    );
  });

  it("is null without a single visit that day: no coverage, not zero", () => {
    const visits = [
      {
        placeId: HOME,
        startMs: at("2026-06-13T10:00:00Z"),
        endMs: at("2026-06-13T12:00:00Z"),
      },
    ];
    expect(awayFromHomeMinutes(visits, dayStart, dayEnd, HOME)).toBeNull();
  });

  it("is null without a home place", () => {
    const visits = [
      {
        placeId: 9,
        startMs: at("2026-06-15T07:00:00Z"),
        endMs: at("2026-06-15T15:00:00Z"),
      },
    ];
    expect(awayFromHomeMinutes(visits, dayStart, dayEnd, null)).toBeNull();
  });

  it("reads a day spent elsewhere as the whole day away", () => {
    const visits = [
      {
        placeId: 9,
        startMs: at("2026-06-15T07:00:00Z"),
        endMs: at("2026-06-15T15:00:00Z"),
      },
    ];
    expect(awayFromHomeMinutes(visits, dayStart, dayEnd, HOME)).toBe(1440);
  });
});

describe("travelDay", () => {
  it("needs a country and a home country", () => {
    expect(travelDay("ES", "DE")).toBe(true);
    expect(travelDay("DE", "DE")).toBe(false);
    expect(travelDay(null, "DE")).toBeNull();
    expect(travelDay("ES", null)).toBeNull();
  });
});

describe("mostFrequentCountry", () => {
  it("counts the window only and breaks a tie alphabetically", () => {
    const map = new Map([
      ["2026-01-01", "ES"],
      ["2026-01-02", "DE"],
      ["2025-01-01", "FR"],
      ["2025-01-02", "FR"],
      ["2025-01-03", "FR"],
    ]);
    expect(mostFrequentCountry(map, "2026-01-01", "2026-12-31")).toBe("DE");
    expect(mostFrequentCountry(map, "2025-01-01", "2026-12-31")).toBe("FR");
    expect(
      mostFrequentCountry(new Map(), "2025-01-01", "2026-12-31"),
    ).toBeNull();
  });
});

describe("buildDayValues", () => {
  it("writes metres, keeps nulls honest and leaves out empty days", () => {
    const rows = buildDayValues({
      days: ["2026-06-15", "2026-06-16", "2026-06-17"],
      tz: "Europe/Berlin",
      timeline: [
        {
          date: "2026-06-15",
          totalKm: 48.3,
          drivingKm: 12,
          trainKm: 30.5,
          placesVisited: 4,
        },
      ],
      visits: [
        {
          placeId: 9,
          startMs: at("2026-06-15T07:00:00Z"),
          endMs: at("2026-06-15T15:00:00Z"),
        },
      ],
      countries: new Map([["2026-06-15", "ES"]]),
      homePlaceId: HOME,
      homeCountry: "DE",
    });
    expect(rows).toEqual([
      {
        date: "2026-06-15",
        totalDistanceM: 48_300,
        drivingDistanceM: 12_000,
        trainDistanceM: 30_500,
        placesVisited: 4,
        awayFromHomeMinutes: 1440,
        countryCode: "ES",
        isTravelDay: true,
      },
    ]);
  });
});
