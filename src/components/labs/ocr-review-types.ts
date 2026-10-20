/**
 * v1.18.9 — the client-side review-row shape for the Lab-OCR screen.
 *
 * A proposed extraction row plus the user's per-row edit + confirm state. The
 * extract DTO seeds it; the review screen mutates it; only confirmed rows are
 * mapped back to the commit payload.
 */
import type { OcrExtractedRowDto } from "@/lib/validations/labs-ocr";

import { readingUnitBlocked } from "./ocr-review-validation";

export interface OcrReviewRow {
  /** Stable client key for the list (the analyte+index at seed time). */
  key: string;
  analyte: string;
  value: number | null;
  valueText: string | null;
  unit: string | null;
  referenceLow: number | null;
  referenceHigh: number | null;
  /** The reference range as printed on the scanned report, verbatim. */
  referenceText: string | null;
  /** ISO calendar day (YYYY-MM-DD) or null. */
  takenAt: string | null;
  confidence: OcrExtractedRowDto["confidence"];
  biomarkerMatch: "new" | "existing";
  /**
   * The unit the matched marker is tracked in; null for a marker that does not
   * exist yet. A numeric row whose `unit` differs from it is converted on
   * Save when it can be (see `readingConversion`) and cannot be saved when not.
   */
  markerUnit: string | null;
  /** Which analyte the matched marker is (catalog slug or registry-only key), or null. */
  markerAnalyteKey: string | null;
  /** Non-null when the server flagged a likely duplicate of a live reading. */
  duplicateOf: string | null;
  /**
   * v1.43 — the marker the server matched the name to (its name, an
   * alias, or a catalog abbreviation), and how; null when nothing matched.
   */
  biomarkerId: string | null;
  matchKind: "name" | "alias" | "catalog" | null;
  /** Up to three markers to choose from when nothing matched. */
  suggestions: OcrExtractedRowDto["suggestions"];
  /** The suggestion the person picked; null keeps the automatic outcome. */
  chosenBiomarkerId: string | null;
  /** Whether the row is selected for saving. Defaults false for duplicates. */
  confirmed: boolean;
}

/** Seed the review rows from the extract response. */
export function seedReviewRows(
  rows: OcrExtractedRowDto[],
  fallbackDate: string | null,
): OcrReviewRow[] {
  return rows.map((row, index) => ({
    key: `${row.analyte}-${index}`,
    analyte: row.analyte,
    value: row.value,
    valueText: row.valueText,
    unit: row.unit,
    referenceLow: row.referenceLow,
    referenceHigh: row.referenceHigh,
    referenceText: row.referenceText,
    takenAt: row.takenAt ?? fallbackDate,
    confidence: row.confidence,
    biomarkerMatch: row.biomarkerMatch,
    markerUnit: row.markerUnit,
    markerAnalyteKey: row.markerAnalyteKey,
    duplicateOf: row.duplicateOf,
    // A scan read before v1.43 carries none of the three.
    biomarkerId: row.biomarkerId ?? null,
    matchKind: row.matchKind ?? null,
    suggestions: row.suggestions ?? [],
    chosenBiomarkerId: null,
    // A flagged duplicate starts unchecked, and so does a reading in another
    // unit than its marker's that cannot be converted (it carries a badge
    // saying why, and ticking it marks the unit field until it is fixed); a
    // reading that converts starts confirmed, with a badge saying what Save
    // will store; everything else starts confirmed.
    confirmed:
      row.duplicateOf === null &&
      !readingUnitBlocked({
        value: row.value,
        valueText: row.valueText,
        unit: row.unit,
        markerUnit: row.markerUnit,
        markerAnalyteKey: row.markerAnalyteKey,
      }),
  }));
}

/**
 * Point a row at a suggestion the person picked, or back at a new marker. The
 * marker's unit and analyte come with the choice, so the unit check and the
 * conversion badge judge the row against the marker it will be filed under.
 */
export function chooseMarker(
  row: OcrReviewRow,
  choice: { biomarkerId: string; unit: string } | null,
  analyteKeyOf: (biomarkerId: string) => string | null,
): OcrReviewRow {
  if (choice === null) {
    return {
      ...row,
      chosenBiomarkerId: null,
      biomarkerMatch: "new",
      markerUnit: null,
      markerAnalyteKey: null,
    };
  }
  return {
    ...row,
    chosenBiomarkerId: choice.biomarkerId,
    biomarkerMatch: "existing",
    markerUnit: choice.unit,
    markerAnalyteKey: analyteKeyOf(choice.biomarkerId),
  };
}
