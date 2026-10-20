import { describe, it, expect } from "vitest";

import {
  placeAgainstBand,
  pickDriverForMetric,
  humaniseType,
} from "@/lib/insights/derived/coach-read-shape";
import type { CoachCorrelationDriver } from "@/lib/ai/coach/tools/correlations-read";

/**
 * v1.21.2 — "Coach read" strip selection logic.
 *
 * Covers the two decisions the strip turns on:
 *   1. band-line placement (within / above / below), incl. the inclusive
 *      edges that read "within", and the insufficient path (no band).
 *   2. driver-line pick + omission — strongest on-metric driver wins, and
 *      nothing on the metric ⇒ the line is omitted (null).
 *
 * Pure helpers — no Prisma, no engine round-trip. The MAD band itself + the
 * 7-day floor are owned by `baseline.test.ts`; this file pins only the strip's
 * own selection seam.
 */

function driver(
  overrides: Partial<CoachCorrelationDriver> &
    Pick<CoachCorrelationDriver, "outcome" | "r">,
): CoachCorrelationDriver {
  return {
    behaviour: "sleep duration",
    direction: overrides.r >= 0 ? "higher" : "lower",
    lagDays: 1,
    n: 42,
    note: "On days your sleep runs short, your resting pulse tends to rise.",
    ...overrides,
  };
}

describe("placeAgainstBand", () => {
  it("reads 'within' when the value sits inside the band", () => {
    expect(placeAgainstBand(72, 60, 80)).toBe("within");
  });

  it("reads 'above' when the value clears the upper edge", () => {
    expect(placeAgainstBand(85, 60, 80)).toBe("above");
  });

  it("reads 'below' when the value sits under the lower edge", () => {
    expect(placeAgainstBand(55, 60, 80)).toBe("below");
  });

  it("treats both edges as inclusive (on-edge reads 'within')", () => {
    expect(placeAgainstBand(60, 60, 80)).toBe("within");
    expect(placeAgainstBand(80, 60, 80)).toBe("within");
  });
});

describe("pickDriverForMetric", () => {
  const restingPulse = humaniseType("RESTING_HEART_RATE" as never); // "resting heart rate"

  it("omits the line when no driver lands on the metric (returns null)", () => {
    const drivers = [
      driver({ outcome: "weight", r: 0.6 }),
      driver({ outcome: "sleep duration", r: -0.5 }),
    ];
    expect(pickDriverForMetric(drivers, restingPulse)).toBeNull();
  });

  it("omits the line on an empty driver list", () => {
    expect(pickDriverForMetric([], restingPulse)).toBeNull();
  });

  it("picks the strongest |r| driver whose outcome is the metric", () => {
    const weak = driver({ outcome: restingPulse, r: 0.21, n: 30 });
    const strong = driver({ outcome: restingPulse, r: -0.48, n: 50 });
    const offMetric = driver({ outcome: "weight", r: 0.9 });

    const picked = pickDriverForMetric([weak, strong, offMetric], restingPulse);
    expect(picked).toBe(strong);
  });

  it("ignores off-metric drivers even when they are stronger", () => {
    const onMetric = driver({ outcome: restingPulse, r: 0.3 });
    const strongerElsewhere = driver({ outcome: "weight", r: 0.95 });

    const picked = pickDriverForMetric(
      [onMetric, strongerElsewhere],
      restingPulse,
    );
    expect(picked).toBe(onMetric);
  });
});
