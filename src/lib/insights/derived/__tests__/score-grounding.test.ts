/**
 * v1.22 — the score-card number-grounding gate. The only numbers the AI
 * score prose may state are the score and its contributor values; anything else
 * is flagged so the caller falls back to the deterministic text.
 */
import { describe, expect, it } from "vitest";

import { findUngroundedScoreNumbers } from "../score-grounding";
import type { MetricSignal } from "@/lib/insights/metric-signal";

function signal(partial: Partial<MetricSignal>): MetricSignal {
  return {
    current: 64,
    delta: -4,
    contributors: [
      { key: "sufficiency", value: 55, weight: 0.4 },
      { key: "efficiency", value: 88, weight: 0.3 },
    ],
    ...partial,
  } as MetricSignal;
}

describe("findUngroundedScoreNumbers", () => {
  it("passes a prose that only cites the score, delta and contributors", () => {
    const s = signal({});
    const prose =
      "Your sleep score landed at 64 today, down 4 from your recent nights. " +
      "Duration (55) weighed on it while efficiency (88) held up well.";
    expect(findUngroundedScoreNumbers(prose, s)).toEqual([]);
  });

  it("allows the 0-100 denominator and small ordinals", () => {
    const s = signal({});
    const prose =
      "Your score is 64 out of 100 — the 2 things to watch are clear.";
    expect(findUngroundedScoreNumbers(prose, s)).toEqual([]);
  });

  it("flags a fabricated figure not present on the signal", () => {
    const s = signal({});
    // 72 is not the score, delta, or any contributor value.
    const found = findUngroundedScoreNumbers(
      "Your score is 64, and your HRV of 72 ms pulled it down.",
      s,
    );
    expect(found.length).toBe(1);
    expect(found[0].value).toBe(72);
  });

  it("rounds the score for a restatement (64.4 → 64)", () => {
    const s = signal({ current: 64.4 });
    expect(findUngroundedScoreNumbers("Your score is 64 today.", s)).toEqual(
      [],
    );
  });

  it("returns empty for empty prose", () => {
    expect(findUngroundedScoreNumbers("", signal({}))).toEqual([]);
  });
});
