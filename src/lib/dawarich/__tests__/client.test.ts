import { describe, expect, it } from "vitest";

import {
  parsePlaces,
  parseResidency,
  parseTimelineDays,
  parseVisits,
} from "../client";

describe("parseTimelineDays", () => {
  it("keeps the summary figures and drops everything else", () => {
    const days = parseTimelineDays({
      days: [
        {
          date: "2026-06-15",
          summary: {
            total_distance: 48.3,
            places_visited: 4,
            mode_distances: { train: 30.5, driving: 12, walking: 1.2 },
          },
          bounds: { sw_lat: 41.1, sw_lng: 2.1 },
          entries: [{ type: "visit", name: "Office" }],
        },
      ],
    });
    expect(days).toEqual([
      {
        date: "2026-06-15",
        totalKm: 48.3,
        drivingKm: 12,
        trainKm: 30.5,
        placesVisited: 4,
      },
    ]);
    expect(JSON.stringify(days)).not.toContain("Office");
  });

  it("reads a mode Dawarich left out as zero for that day", () => {
    const [day] = parseTimelineDays({
      days: [{ date: "2026-06-15", summary: { total_distance: 2.1 } }],
    });
    expect(day.drivingKm).toBe(0);
    expect(day.trainKm).toBe(0);
    expect(day.placesVisited).toBeNull();
  });

  it("answers nothing for a payload that is not a timeline", () => {
    expect(parseTimelineDays({ error: "nope" })).toEqual([]);
    expect(parseTimelineDays(null)).toEqual([]);
    expect(
      parseTimelineDays({ days: [{ date: "yesterday", summary: {} }] }),
    ).toEqual([]);
  });
});

describe("parseVisits", () => {
  it("reduces a visit to its place id and span, and drops declined ones", () => {
    const visits = parseVisits([
      {
        id: 1,
        started_at: "2026-06-15T07:00:00Z",
        ended_at: "2026-06-15T15:00:00Z",
        status: "confirmed",
        name: "Office",
        place: { id: 9, latitude: 52.5, longitude: 13.4 },
      },
      {
        id: 2,
        started_at: "2026-06-15T16:00:00Z",
        ended_at: "2026-06-15T17:00:00Z",
        status: "declined",
        place: { id: 7 },
      },
      { id: 3, started_at: "bad", ended_at: "2026-06-15T17:00:00Z" },
    ]);
    expect(visits).toEqual([
      {
        placeId: 9,
        startMs: Date.parse("2026-06-15T07:00:00Z"),
        endMs: Date.parse("2026-06-15T15:00:00Z"),
      },
    ]);
  });
});

describe("parseResidency", () => {
  it("translates each day's country name into its alpha-2 code", () => {
    const map = parseResidency({
      year: 2026,
      daily_countries: {
        "2026-06-15": "Spain",
        "2026-06-14": "Germany",
        "2026-06-13": "Atlantis",
      },
      countries: [
        { country_name: "Spain", iso_a2: "ES" },
        { country_name: "Germany", iso_a2: "de" },
        { country_name: "Atlantis", iso_a2: null },
      ],
    });
    expect([...map]).toEqual([
      ["2026-06-15", "ES"],
      ["2026-06-14", "DE"],
    ]);
  });
});

describe("parsePlaces", () => {
  const payload = [
    { id: 9, name: "Office", latitude: 52.5 },
    { id: 7, name: "Home", longitude: 13.4 },
    { id: 3, name: "  " },
    { id: "x", name: "Broken" },
  ];

  it("keeps id and name, sorted by name", () => {
    expect(parsePlaces(payload)).toEqual([
      { id: 7, name: "Home" },
      { id: 9, name: "Office" },
    ]);
  });

  it("filters by the query, ignoring case", () => {
    expect(parsePlaces(payload, "off")).toEqual([{ id: 9, name: "Office" }]);
  });
});
