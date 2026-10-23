/**
 * Pure step grammar for the one-question-at-a-time check-in.
 *
 * Every instrument runs the same sequence: its items `1..itemCount`, the
 * PHQ-9's optional follow-up question as one more step, then a review step
 * that lists every answer before anything is sent. The review step came
 * back at a maintainer's request: a screener that submits on the last tap
 * gives no chance to see what is about to be recorded. Backward navigation
 * is always allowed and nothing skips past an unanswered item. Keeping the
 * grammar here makes it unit-testable without driving a DOM.
 *
 * Step numbers are 1-based. An unanswered item carries the sentinel `-1`.
 */

export const UNANSWERED = -1;

/** Every item answered — gates the review step and the submit. */
export function isComplete(items: readonly number[]): boolean {
  return items.length > 0 && items.every((v) => v >= 0);
}

/** The step after `step`, clamped at the last one. */
export function nextStep(step: number, totalSteps: number): number {
  if (step >= totalSteps) return totalSteps;
  return step + 1;
}

/** The previous step, clamped at the first question. */
export function prevStep(step: number): number {
  return step > 1 ? step - 1 : 1;
}

/**
 * The step layout of one instrument: how many questions it asks (its items
 * plus the optional follow-up) and the review step after them.
 */
export function checkInSteps(
  itemCount: number,
  hasFunctional: boolean,
): { questions: number; functionalStep: number | null; review: number } {
  const questions = itemCount + (hasFunctional ? 1 : 0);
  return {
    questions,
    functionalStep: hasFunctional ? itemCount + 1 : null,
    review: questions + 1,
  };
}

/**
 * The first unanswered item's step, or null when every item is answered.
 * The review step is only reachable once this is null.
 */
export function firstUnanswered(items: readonly number[]): number | null {
  const index = items.findIndex((v) => v < 0);
  return index === -1 ? null : index + 1;
}
