import { describe, expect, it } from "vitest";

import { importValue } from "../import-value";

describe("importValue", () => {
  it("drops the binary noise provider arithmetic leaves behind", () => {
    expect(importValue(72.30000000000001)).toBe(72.3);
    expect(importValue(0.1 + 0.2)).toBe(0.3);
    // Withings: value * 10^unit.
    expect(importValue(78456 * Math.pow(10, -3))).toBe(78.46);
    expect(String(importValue(1234 * 0.01))).toBe("12.34");
  });

  it("rounds halves on the decimal the value prints as, away from zero", () => {
    // `(1.005).toFixed(2)` is "1.00".
    expect(importValue(1.005)).toBe(1.01);
    expect(importValue(-0.125)).toBe(-0.13);
    expect(importValue(2.675)).toBe(2.68);
  });

  it("keeps whole numbers, zero and non-finite values as they are", () => {
    expect(importValue(64)).toBe(64);
    expect(Object.is(importValue(-0.001), 0)).toBe(true);
    expect(importValue(0)).toBe(0);
    expect(importValue(Number.NaN)).toBeNaN();
    expect(importValue(1e-7)).toBe(0);
    expect(importValue(1e22)).toBe(1e22);
  });

  it("rounds to another precision on request, halves away from zero", () => {
    expect(importValue(72.34999, 1)).toBe(72.3);
    expect(importValue(1.0005, 3)).toBe(1.001);
    expect(importValue(-2.5, 0)).toBe(-3);
    expect(importValue(0.30000000000000004, 3)).toBe(0.3);
    expect(() => importValue(1, 7)).toThrow(RangeError);
  });
});
