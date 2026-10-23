/**
 * The bound on a biomarker's history in the Coach labs block (#1263).
 *
 * Labs reach back over the whole record now, so a marker measured four times
 * a year for twenty years must not put eighty readings into the prompt. The
 * newest few earlier readings go in full, older ones fold into one entry per
 * calendar year, and only the newest years are listed.
 */
import { describe, expect, it } from "vitest";

import {
  LAB_HISTORY_MAX_YEARS,
  LAB_HISTORY_RECENT_POINTS,
  shapeLabHistory,
  type LabHistoryInput,
} from "../labs-snapshot";

const LATEST = new Date("2026-09-15T08:00:00.000Z");

/** Quarterly readings going back `years`, newest first, LATEST excluded. */
function quarterly(years: number): LabHistoryInput[] {
  const out: LabHistoryInput[] = [];
  for (let q = 1; q <= years * 4; q++) {
    const at = new Date(LATEST);
    at.setUTCMonth(at.getUTCMonth() - 3 * q);
    out.push({ value: 100 + q, takenAt: at, rangeStatus: "in-range" });
  }
  return out;
}

describe("shapeLabHistory", () => {
  it("is null without earlier readings", () => {
    expect(shapeLabHistory(LATEST, [])).toBeNull();
  });

  it("lists a short history in full", () => {
    const history = shapeLabHistory(LATEST, quarterly(1));
    expect(history?.count).toBe(5);
    expect(history?.earlier).toHaveLength(4);
    expect(history?.yearly).toEqual([]);
    expect(history?.yearsOmitted).toBe(0);
  });

  it("folds a twenty-year history into a bounded summary", () => {
    const earlier = quarterly(20);
    const history = shapeLabHistory(LATEST, earlier)!;

    expect(history.count).toBe(earlier.length + 1);
    expect(history.firstTakenAt).toBe(earlier.at(-1)!.takenAt.toISOString());
    expect(history.earlier).toHaveLength(LAB_HISTORY_RECENT_POINTS);
    expect(history.earlier[0].value).toBe(earlier[0].value);
    expect(history.yearly).toHaveLength(LAB_HISTORY_MAX_YEARS);
    // Newest year first, and every folded reading is accounted for.
    const years = history.yearly.map((entry) => entry.year);
    expect(years).toEqual([...years].sort((a, b) => b - a));
    const listedYears = new Set(
      earlier
        .slice(LAB_HISTORY_RECENT_POINTS)
        .map((r) => r.takenAt.getUTCFullYear()),
    );
    expect(history.yearsOmitted).toBe(listedYears.size - LAB_HISTORY_MAX_YEARS);
  });

  it("summarises a year as mean, min, max and count of its readings", () => {
    const year = (value: number, month: number): LabHistoryInput => ({
      value,
      takenAt: new Date(Date.UTC(2019, month, 1)),
      rangeStatus: "above",
    });
    const recent = Array.from(
      { length: LAB_HISTORY_RECENT_POINTS },
      (_, i) => ({
        value: 90,
        takenAt: new Date(Date.UTC(2025, 11 - i, 1)),
        rangeStatus: "in-range" as const,
      }),
    );
    const history = shapeLabHistory(LATEST, [
      ...recent,
      year(160, 10),
      year(150, 6),
      year(141, 2),
    ])!;
    expect(history.yearly).toEqual([
      { year: 2019, count: 3, mean: 150.33, min: 141, max: 160 },
    ]);
  });
});
