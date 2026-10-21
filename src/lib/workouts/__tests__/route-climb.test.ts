import { describe, expect, it } from "vitest";

import { routeClimbM } from "../route-climb";

describe("routeClimbM", () => {
  it("sums only the positive altitude deltas", () => {
    const geometry = {
      type: "LineString",
      coordinates: [
        [8, 50, 100],
        [8, 50, 140],
        [8, 50, 110],
        [8, 50, 160],
      ],
    };
    // +40 then −30 then +50 → 90 climbed, not 60 net.
    expect(routeClimbM(geometry)).toBe(90);
  });

  it("returns null when the geometry carries no altitude channel", () => {
    // Withings ships static GPX with no altitudes. Reporting a confident 0
    // would be a claim about flat terrain that the data does not make.
    expect(
      routeClimbM({
        type: "LineString",
        coordinates: [
          [8, 50],
          [8.1, 50.1],
        ],
      }),
    ).toBeNull();
    expect(routeClimbM(null)).toBeNull();
    expect(routeClimbM("not geometry")).toBeNull();
  });
});
