import { describe, expect, it } from "vitest";

import { completedCycleLengths } from "../read";
import { shapeLabPanel } from "../labs";

const NOW = new Date("2026-10-23T12:00:00Z");

function reading(biomarkerId: string, value: number, takenAt: string) {
  return {
    biomarkerId,
    value,
    takenAt: new Date(takenAt),
    sourceReferenceLow: null,
    sourceReferenceHigh: null,
    sourceReferenceText: null,
    sourceUnit: null,
  };
}

describe("shapeLabPanel", () => {
  const markers = [
    { id: "ldl", name: "LDL", unit: "mg/dL", lowerBound: 0, upperBound: 130 },
    {
      id: "vitd",
      name: "Vitamin D",
      unit: "ng/mL",
      lowerBound: 30,
      upperBound: 100,
    },
    {
      id: "none",
      name: "Unused",
      unit: "x",
      lowerBound: null,
      upperBound: null,
    },
  ];

  it("judges the newest reading and carries the marker's trend", () => {
    const panel = shapeLabPanel(
      markers,
      [
        reading("ldl", 98, "2026-10-01T08:00:00Z"),
        reading("ldl", 120, "2025-09-01T08:00:00Z"),
        reading("ldl", 140, "2024-08-01T08:00:00Z"),
        reading("vitd", 24, "2026-09-10T08:00:00Z"),
      ],
      NOW,
    );
    expect(panel).not.toBeNull();
    expect(panel!.markers.map((m) => m.biomarkerId)).toEqual(["ldl", "vitd"]);
    const ldl = panel!.markers[0];
    expect(ldl).toMatchObject({ latest: 98, status: "in-range", readings: 3 });
    expect(ldl.trend.status).toBe("ok");
    const vitd = panel!.markers[1];
    expect(vitd.status).toBe("below");
    // One reading is not a trend; the panel says so rather than drawing one.
    expect(vitd.trend).toMatchObject({ status: "insufficient", n: 1 });
    expect(panel).toMatchObject({
      inRange: 1,
      withRange: 2,
      latestOn: "2026-10-01",
    });
  });

  it("is absent without a single numeric reading", () => {
    expect(shapeLabPanel(markers, [], NOW)).toBeNull();
  });
});

describe("completedCycleLengths", () => {
  it("measures between logged starts and skips gaps in logging", () => {
    expect(
      completedCycleLengths([
        "2026-06-01",
        "2026-06-29",
        "2026-07-28",
        "2026-10-20",
      ]),
    ).toEqual([28, 29]);
    expect(completedCycleLengths(["2026-06-01"])).toEqual([]);
  });
});
