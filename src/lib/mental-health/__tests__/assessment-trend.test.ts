import { describe, expect, it } from "vitest";

import {
  computeAssessmentTrends,
  MEANINGFUL_CHANGE,
  verdictForChange,
} from "../assessment-trend";

const row = (
  id: string,
  instrument: string,
  totalScore: number,
  day: string,
) => ({
  id,
  instrument,
  totalScore,
  takenAt: new Date(`${day}T09:00:00.000Z`),
});

describe("meaningful-change thresholds", () => {
  it("are the published minimal important differences", () => {
    expect(MEANINGFUL_CHANGE).toEqual({ PHQ9: 5, GAD7: 4, WHO5: 10 });
  });

  it("classify in the instrument's direction, inclusive at the threshold", () => {
    expect(verdictForChange(-5, 5, false)).toBe("improved");
    expect(verdictForChange(-4, 5, false)).toBe("within_threshold");
    expect(verdictForChange(5, 5, false)).toBe("worsened");
    expect(verdictForChange(12, 10, true)).toBe("improved");
    expect(verdictForChange(-10, 10, true)).toBe("worsened");
  });
});

describe("computeAssessmentTrends", () => {
  it("compares the latest score with the previous and the first", () => {
    const trends = computeAssessmentTrends([
      row("c", "PHQ9", 9, "2026-06-01"),
      row("a", "PHQ9", 16, "2026-01-10"),
      row("b", "PHQ9", 12, "2026-03-15"),
      row("g", "GAD7", 10, "2026-03-15"),
      row("h", "GAD7", 13, "2026-06-01"),
      row("w", "WHO5", 44, "2026-06-01"),
      row("s", "SCI", 20, "2026-06-01"),
    ]);
    expect(trends.map((t) => t.instrument)).toEqual(["PHQ9", "GAD7", "WHO5"]);
    const [phq, gad, who] = trends;
    expect(phq).toMatchObject({
      n: 3,
      threshold: 5,
      changeFromPrevious: -3,
      changeFromFirst: -7,
      sincePrevious: "within_threshold",
      sinceFirst: "improved",
      first: { score: 16 },
      latest: { score: 9 },
    });
    expect(gad).toMatchObject({
      n: 2,
      changeFromPrevious: 3,
      sincePrevious: "within_threshold",
    });
    expect(who).toMatchObject({
      n: 1,
      previous: null,
      changeFromPrevious: null,
      sincePrevious: null,
      sinceFirst: null,
    });
  });

  it("orders same-day administrations by id", () => {
    const [phq] = computeAssessmentTrends([
      row("b", "PHQ9", 20, "2026-06-01"),
      row("a", "PHQ9", 10, "2026-06-01"),
    ]);
    expect(phq.latest.score).toBe(20);
    expect(phq.sincePrevious).toBe("worsened");
  });
});
