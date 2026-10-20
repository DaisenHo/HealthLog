/**
 * v1.21.2 — no-tools/local-provider parity for the prose number-verifier.
 *
 * On the no-tools path the Coach has no tools, so the authoritative figure set
 * is the SNAPSHOT the model was shown — the structured `snapshot.sections`
 * record `snapshotJson` is serialised from, which already carries the
 * correlations-snapshot block. This proves the SAME verifier grades prose
 * against that record: a number present in the snapshot (including a
 * correlations-block leaf) is not flagged; a number absent from it is flagged
 * exactly as on the tool path.
 */
import { describe, expect, it } from "vitest";

import { findUnverifiedCoachNumbers } from "@/lib/ai/coach/coach-prose-grounding";

/**
 * A representative `snapshot.sections` record: a derived block plus the
 * correlations-snapshot block (a `CorrelationsSnapshotBlock`) the no-tools path
 * folds in. The driver's numeric leaves (`r`, `n`, `pairsTested`, `windowDays`)
 * are authoritative figures the model may legitimately cite.
 */
const snapshotSections: Record<string, unknown> = {
  bloodPressure: {
    aggregate: { avgSys30: 128, avgDia30: 82 },
  },
  correlations: {
    drivers: [
      {
        behaviour: "sleep duration",
        outcome: "resting heart rate",
        direction: "lower",
        lagDays: 1,
        n: 24,
        r: 0.62,
        note: "More sleep tracked with a lower next-day resting heart rate.",
      },
    ],
    pairsTested: 18,
    windowDays: 90,
  },
};

// The route passes the structured record as a single authoritative payload.
const noToolsPayloads: unknown[] = [snapshotSections];

describe("no-tools verifier parity", () => {
  it("does not flag a number that traces to a snapshot leaf", () => {
    const prose = "Your systolic averaged 128 and diastolic 82 this month.";
    expect(findUnverifiedCoachNumbers(prose, noToolsPayloads)).toEqual([]);
  });

  it("does not flag a number that traces to the correlations-snapshot block", () => {
    // r = 0.62 is a leaf of the correlations block folded into the snapshot.
    const prose = "Sleep and resting heart rate moved together (r = 0.62).";
    expect(findUnverifiedCoachNumbers(prose, noToolsPayloads)).toEqual([]);
  });

  it("flags a number the snapshot never carried", () => {
    const prose = "Your systolic averaged about 138 recently.";
    const findings = findUnverifiedCoachNumbers(prose, noToolsPayloads);
    expect(findings).toHaveLength(1);
    expect(findings[0].value).toBe(138);
  });

  it("no-ops when the snapshot was not delivered this turn", () => {
    // Cheap follow-up: the route leaves the no-tools payload set empty, so even
    // an invented figure is not graded — the prompt-level rule is the backstop.
    const prose = "Your systolic averaged 138 recently.";
    expect(findUnverifiedCoachNumbers(prose, [])).toEqual([]);
  });
});
