import { describe, expect, it } from "vitest";

import { makeFormatters } from "@/lib/format-locale";
import { formatLabReading, formatLabValue } from "../format-value";

const de = makeFormatters("de", "UTC", "AUTO", "AUTO").number;
const en = makeFormatters("en", "UTC", "AUTO", "AUTO").number;
const labNumber = (value: number, printed?: number | null) =>
  formatLabValue(value, de, printed);

describe("lab value formatting", () => {
  // These readings used to be trimmed to two decimals above 1 and three
  // significant digits below, so 12.3456 read "12.35" and 0.123456 "0.123":
  // digits the lab reported were dropped. A reading now keeps them all.
  it("keeps every recorded digit and prints the locale's separator", () => {
    expect(formatLabValue(1.8, de)).toBe("1,8");
    expect(formatLabValue(1.8, en)).toBe("1.8");
    expect(formatLabValue(0.123456, de)).toBe("0,123456");
    expect(formatLabValue(12.3456, de)).toBe("12,3456");
    expect(formatLabValue(5, de)).toBe("5");
  });

  it("never shows a small nonzero reading as zero or shortened", () => {
    expect(formatLabValue(0.004, de)).toBe("0,004");
    expect(formatLabValue(0.012, en)).toBe("0.012");
    expect(formatLabValue(0.035, de)).toBe("0,035");
    expect(formatLabValue(0.034, en)).toBe("0.034");
    expect(formatLabValue(0.0012, en)).toBe("0.0012");
  });

  it("drops binary floating-point noise, never a recorded digit", () => {
    expect(formatLabValue(0.1 + 0.2, en)).toBe("0.3");
    expect(formatLabValue(1234.5678, en)).toBe("1,234.5678");
  });

  it("prints a converted reading with the precision its report printed", () => {
    // 5.2 mmol/L of cholesterol converted to mg/dL.
    expect(formatLabValue(5.2 * 38.67, en, 5.2)).toBe("201");
    // A four-digit report figure keeps four significant digits.
    expect(formatLabValue(5.234 * 38.67, en, 5.234)).toBe("202.4");
    // Never fewer digits than the integer part.
    expect(formatLabValue(12.5 * 88.4, en, 12.5)).toBe("1,105");
  });

  it("formats a numeric reading with its unit and leaves a qualitative one verbatim", () => {
    expect(
      formatLabReading({ value: 61.3, valueText: null, unit: "kg" }, labNumber),
    ).toBe("61,3 kg");
    expect(
      formatLabReading(
        { value: null, valueText: "negativ", unit: "" },
        labNumber,
      ),
    ).toBe("negativ");
    expect(
      formatLabReading(
        {
          value: 5.2 * 38.67,
          valueText: null,
          unit: "mg/dL",
          sourceValue: 5.2,
        },
        labNumber,
      ),
    ).toBe("201 mg/dL");
  });
});
