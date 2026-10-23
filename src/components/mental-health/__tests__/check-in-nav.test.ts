import { describe, it, expect } from "vitest";

import {
  UNANSWERED,
  checkInSteps,
  firstUnanswered,
  isComplete,
  nextStep,
  prevStep,
} from "../check-in-nav";

/**
 * The check-in is LINEAR and the same for every instrument: the items, the
 * PHQ-9's optional follow-up, then a review step that is the only place that
 * submits. These are the contracts the wizard's advance / back behaviour
 * rests on (the SSR-only component tests cannot drive clicks; the e2e
 * journey drives them end to end).
 */

const PHQ9 = 9;
const GAD7 = 7;

function blank(count: number): number[] {
  return Array(count).fill(UNANSWERED);
}

describe("check-in step layout", () => {
  it("puts the review step after the last question of every instrument", () => {
    expect(checkInSteps(PHQ9, true)).toEqual({
      questions: 10,
      functionalStep: 10,
      review: 11,
    });
    expect(checkInSteps(GAD7, false)).toEqual({
      questions: 7,
      functionalStep: null,
      review: 8,
    });
    expect(checkInSteps(5, false).review).toBe(6);
    expect(checkInSteps(8, false).review).toBe(9);
  });

  it("advances forward and stops at the review step", () => {
    const { review } = checkInSteps(PHQ9, true);
    expect(nextStep(1, review)).toBe(2);
    expect(nextStep(10, review)).toBe(11);
    expect(nextStep(11, review)).toBe(11);
  });

  it("steps back, clamped at the first question", () => {
    expect(prevStep(11)).toBe(10);
    expect(prevStep(2)).toBe(1);
    expect(prevStep(1)).toBe(1);
  });
});

describe("completeness (gates the review and the submit)", () => {
  it("isComplete requires every item answered", () => {
    expect(isComplete(blank(PHQ9))).toBe(false);
    const partial = blank(PHQ9).map((_, i) => (i < 5 ? 1 : UNANSWERED));
    expect(isComplete(partial)).toBe(false);
    expect(isComplete(blank(PHQ9).map(() => 0))).toBe(true);
    expect(isComplete(blank(GAD7).map(() => 3))).toBe(true);
  });

  it("names the first unanswered item's step", () => {
    expect(firstUnanswered(blank(GAD7))).toBe(1);
    expect(firstUnanswered([0, 1, UNANSWERED, 2])).toBe(3);
    expect(firstUnanswered([0, 1, 2, 3])).toBeNull();
  });
});
