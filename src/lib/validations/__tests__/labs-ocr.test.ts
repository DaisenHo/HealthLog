import { describe, it, expect } from "vitest";

import { ocrCommitSchema, OCR_MAX_ROWS, parseExtractedLabs } from "../labs-ocr";

describe("parseExtractedLabs (untrusted provider output)", () => {
  it("parses a well-formed numeric + qualitative envelope", () => {
    const parsed = parseExtractedLabs({
      reportDate: "2026-06-14",
      rows: [
        {
          analyte: "LDL-Cholesterin",
          value: 142,
          valueText: null,
          unit: "mg/dL",
          referenceLow: 0,
          referenceHigh: 116,
          takenAt: "2026-06-14",
          confidence: { analyte: 0.9, value: 0.8, unit: 0.9, range: 0.7 },
        },
        {
          analyte: "Borrelia IgG",
          value: null,
          valueText: "negativ",
          unit: null,
          referenceLow: null,
          referenceHigh: null,
          takenAt: null,
          confidence: { analyte: 0.95, value: 0.9, unit: 0, range: 0 },
        },
      ],
    });
    expect(parsed?.rows).toHaveLength(2);
    expect(parsed?.rows[1].valueText).toBe("negativ");
    expect(parsed?.droppedRows).toBe(0);
  });

  it("tolerates a missing confidence block (defaults to 0 = flag for review)", () => {
    const parsed = parseExtractedLabs({
      reportDate: null,
      rows: [
        {
          analyte: "Ferritin",
          value: null,
          valueText: null,
          unit: "ng/mL",
          referenceLow: null,
          referenceHigh: null,
          takenAt: null,
        },
      ],
    });
    expect(parsed?.rows[0].confidence).toEqual({
      analyte: 0,
      value: 0,
      unit: 0,
      range: 0,
    });
  });

  it("coerces a garbage value to null rather than rejecting the row", () => {
    const parsed = parseExtractedLabs({
      reportDate: null,
      rows: [
        {
          analyte: "TSH",
          value: "not a number",
          valueText: null,
          unit: "mIU/L",
          referenceLow: null,
          referenceHigh: null,
          takenAt: null,
          confidence: { analyte: 1, value: 0, unit: 1, range: 0 },
        },
      ],
    });
    expect(parsed?.rows[0].value).toBeNull();
  });

  // A report with more readings than the old 100-row cap used to fail as a
  // whole: the envelope's `.max()` rejected the lot. The cap is applied after
  // the merge now, keeping the first rows (see ocr-extract tests).
  it("accepts more rows than OCR_MAX_ROWS (the cap keeps rows, it never rejects)", () => {
    const rows = Array.from({ length: OCR_MAX_ROWS + 1 }, (_, i) => ({
      analyte: `X${i}`,
      value: 1,
      valueText: null,
      unit: "u",
      referenceLow: null,
      referenceHigh: null,
      takenAt: null,
      confidence: { analyte: 1, value: 1, unit: 1, range: 1 },
    }));
    expect(parseExtractedLabs({ reportDate: null, rows })?.rows).toHaveLength(
      OCR_MAX_ROWS + 1,
    );
  });

  it("drops a malformed row and keeps the others", () => {
    const parsed = parseExtractedLabs({
      reportDate: "2026-06-14",
      rows: [
        { analyte: "Ferritin", value: 80, unit: "ng/mL" },
        { analyte: "", value: 1, unit: "u" },
        { value: 2 },
        "not a row",
        { analyte: "a".repeat(201), value: 3, unit: "u" },
        { analyte: "TSH", value: 1.2, unit: "mIU/L" },
      ],
    });
    expect(parsed?.rows.map((r) => r.analyte)).toEqual(["Ferritin", "TSH"]);
    expect(parsed?.droppedRows).toBe(4);
    expect(parsed?.reportDate).toBe("2026-06-14");
  });

  it("is null for an envelope without a rows array", () => {
    expect(parseExtractedLabs(undefined)).toBeNull();
    expect(parseExtractedLabs({ reportDate: null })).toBeNull();
    expect(parseExtractedLabs({ rows: "x" })).toBeNull();
  });
});

describe("ocrCommitSchema (confirmed rows)", () => {
  const base = {
    analyte: "LDL",
    takenAt: "2026-06-14T08:00:00.000Z",
  };

  it("accepts a numeric row with a unit", () => {
    const parsed = ocrCommitSchema.safeParse({
      rows: [{ ...base, value: 142, unit: "mg/dL", referenceHigh: 116 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a qualitative row without a unit", () => {
    const parsed = ocrCommitSchema.safeParse({
      rows: [
        {
          analyte: "Borrelia IgG",
          valueText: "negativ",
          takenAt: base.takenAt,
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a numeric row missing a unit", () => {
    const parsed = ocrCommitSchema.safeParse({
      rows: [{ ...base, value: 142 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a row with both value and valueText", () => {
    const parsed = ocrCommitSchema.safeParse({
      rows: [{ ...base, value: 1, valueText: "x", unit: "u" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a row with neither value nor valueText", () => {
    const parsed = ocrCommitSchema.safeParse({
      rows: [{ ...base, unit: "u" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a transposed reference range", () => {
    const parsed = ocrCommitSchema.safeParse({
      rows: [
        { ...base, value: 1, unit: "u", referenceLow: 10, referenceHigh: 1 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty rows array", () => {
    expect(ocrCommitSchema.safeParse({ rows: [] }).success).toBe(false);
  });

  it("takes a 300-row report in one commit, and no more than OCR_MAX_ROWS", () => {
    const rows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        ...base,
        analyte: `Marker ${i}`,
        value: i,
        unit: "u",
      }));
    expect(ocrCommitSchema.safeParse({ rows: rows(300) }).success).toBe(true);
    expect(
      ocrCommitSchema.safeParse({ rows: rows(OCR_MAX_ROWS) }).success,
    ).toBe(true);
    expect(
      ocrCommitSchema.safeParse({ rows: rows(OCR_MAX_ROWS + 1) }).success,
    ).toBe(false);
  });
});
