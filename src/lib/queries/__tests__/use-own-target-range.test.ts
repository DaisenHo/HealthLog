import { describe, expect, it } from "vitest";

import { selectOwnTargetRange } from "../use-own-target-range";

const range = { greenMin: 88, greenMax: 92, orangeMin: 87.4, orangeMax: 92.6 };

describe("selectOwnTargetRange", () => {
  it("returns the resolved range when the person set the target", () => {
    expect(
      selectOwnTargetRange(
        { effective: { OXYGEN_SATURATION: { range, isOverride: true } } },
        "OXYGEN_SATURATION",
      ),
    ).toEqual(range);
  });

  it("returns null for a default range, so the chart keeps its own band", () => {
    expect(
      selectOwnTargetRange(
        { effective: { OXYGEN_SATURATION: { range, isOverride: false } } },
        "OXYGEN_SATURATION",
      ),
    ).toBeNull();
  });

  it("returns null before the read lands or for an absent metric", () => {
    expect(selectOwnTargetRange(null, "OXYGEN_SATURATION")).toBeNull();
    expect(selectOwnTargetRange({ effective: {} }, "PULSE")).toBeNull();
  });
});
