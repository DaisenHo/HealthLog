import { describe, expect, it } from "vitest";

import { getUnitForType } from "@/lib/measurements/unit-map";
import { getDisplayTransform } from "@/lib/measurements/display-transform";
import { getMeasurementCategory } from "@/lib/measurements/categories";
import { createMeasurementSchema } from "@/lib/validations/measurement";

/**
 * Room climate as a Home Assistant automation pushes it: the documented
 * three-reading array through the ingest token, no source, no unit.
 */
const at = new Date(Date.now() - 60_000).toISOString();

describe("indoor climate types", () => {
  it("accepts the documented push shape for all three", () => {
    for (const [type, value] of [
      ["INDOOR_CO2", 812],
      ["INDOOR_TEMPERATURE", 21.4],
      ["INDOOR_HUMIDITY", 47],
    ] as const) {
      expect(
        createMeasurementSchema.safeParse({ type, value, measuredAt: at })
          .success,
        type,
      ).toBe(true);
    }
  });

  it("refuses a reading no room produces", () => {
    for (const [type, value] of [
      ["INDOOR_CO2", 12_000],
      ["INDOOR_TEMPERATURE", 75],
      ["INDOOR_HUMIDITY", 101],
    ] as const) {
      expect(
        createMeasurementSchema.safeParse({ type, value, measuredAt: at })
          .success,
        type,
      ).toBe(false);
    }
  });

  it("stores canonical units and shows temperature in the person's scale", () => {
    expect(getUnitForType("INDOOR_CO2")).toBe("ppm");
    expect(getUnitForType("INDOOR_TEMPERATURE")).toBe("celsius");
    expect(getUnitForType("INDOOR_HUMIDITY")).toBe("%");
    expect(
      getDisplayTransform("INDOOR_TEMPERATURE", "imperial").displayUnit,
    ).toBe("°F");
  });

  it("files all three under the environment cluster", () => {
    for (const type of [
      "INDOOR_CO2",
      "INDOOR_TEMPERATURE",
      "INDOOR_HUMIDITY",
    ] as const) {
      expect(getMeasurementCategory(type)).toBe("environment");
    }
  });
});
