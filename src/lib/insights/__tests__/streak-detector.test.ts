import { describe, it, expect } from "vitest";

import {
  detectStreak,
  MIN_OUT_RUN,
  type StreakPoint,
} from "@/lib/insights/streak-detector";

/**
 * v1.21.2 — determinism pins for the streak / return-to-baseline detector.
 *
 * The PROSE the Coach narrates is not tested; the FLAGS are. These assert:
 *   - an in-band streak counts consecutive in-band days,
 *   - a calendar GAP day breaks a streak,
 *   - a return-to-baseline event fires only after a genuine prior out-of-band
 *     run, and never on a one-day blip,
 *   - too little history omits rather than guesses.
 */

/** A series of N consecutive days starting at 2026-06-01, with given values. */
function consecutive(values: number[], startDay = 1): StreakPoint[] {
  return values.map((value, i) => ({
    day: `2026-06-${String(startDay + i).padStart(2, "0")}`,
    value,
  }));
}

const IN_BAND = { low: 60, high: 80 };

describe("detectStreak — in-band streak", () => {
  it("counts consecutive in-band days back from the latest", () => {
    // All five days sit inside [60,80].
    const res = detectStreak(consecutive([70, 71, 69, 72, 70]), IN_BAND);
    expect(res.latestPlacement).toBe("in");
    expect(res.inBand).toBe(true);
    expect(res.streakDays).toBe(5);
    expect(res.returnEvent).toBeUndefined();
  });

  it("a calendar gap breaks the streak", () => {
    // Days 1-3 in-band, then a gap (no day 4), then day 5 in-band. The streak
    // counting back from day 5 is only 1 — the gap severs it.
    const series: StreakPoint[] = [
      { day: "2026-06-01", value: 70 },
      { day: "2026-06-02", value: 71 },
      { day: "2026-06-03", value: 69 },
      // gap: no 2026-06-04
      { day: "2026-06-05", value: 72 },
    ];
    const res = detectStreak(series, IN_BAND);
    expect(res.inBand).toBe(true);
    expect(res.streakDays).toBe(1);
  });

  it("an out-of-band streak counts only the same side", () => {
    // Latest day is above; the prior day was below — different runs, so the
    // streak counting back from the latest above-day is 1.
    const res = detectStreak(consecutive([50, 95]), IN_BAND);
    expect(res.latestPlacement).toBe("above");
    expect(res.inBand).toBe(false);
    expect(res.streakDays).toBe(1);
  });
});

describe("detectStreak — return-to-baseline event", () => {
  it("fires after a genuine prior out-of-band run", () => {
    // Three days above the band, then three days back inside it. The latest is
    // in-band with a settled run, preceded by an out-of-band run of 3.
    const res = detectStreak(consecutive([95, 96, 94, 70, 71, 69]), IN_BAND);
    expect(res.inBand).toBe(true);
    expect(res.streakDays).toBe(3);
    expect(res.returnEvent).toBeDefined();
    expect(res.returnEvent).toEqual({
      daysInside: 3,
      priorDaysOutside: 3,
      priorDirection: "above",
    });
  });

  it("does not fire on a one-day blip (below MIN_OUT_RUN)", () => {
    // A single above-band day before the in-band run is not a run to return
    // from — MIN_OUT_RUN gates it out.
    expect(MIN_OUT_RUN).toBe(2);
    const res = detectStreak(consecutive([95, 70, 71, 69]), IN_BAND);
    expect(res.inBand).toBe(true);
    expect(res.returnEvent).toBeUndefined();
  });

  it("does not fire when a gap separates the out-of-band run from the return", () => {
    // Out-of-band run, then a gap, then the in-band run. The return cannot
    // bridge a missing calendar day, so no event fires.
    const series: StreakPoint[] = [
      { day: "2026-06-01", value: 95 },
      { day: "2026-06-02", value: 96 },
      // gap: no 2026-06-03
      { day: "2026-06-04", value: 70 },
      { day: "2026-06-05", value: 71 },
    ];
    const res = detectStreak(series, IN_BAND);
    expect(res.inBand).toBe(true);
    expect(res.returnEvent).toBeUndefined();
  });

  it("does not fire when the metric never left the band", () => {
    const res = detectStreak(consecutive([70, 71, 69, 72]), IN_BAND);
    expect(res.returnEvent).toBeUndefined();
  });
});

describe("detectStreak — conservatism", () => {
  it("omits (null placement, no event) on an empty series", () => {
    const res = detectStreak([], IN_BAND);
    expect(res.latestPlacement).toBeNull();
    expect(res.streakDays).toBe(0);
    expect(res.returnEvent).toBeUndefined();
  });

  it("builds a personal band from the series when none is supplied", () => {
    // A long, steady run with one recent dip. The MAD band derives from the
    // whole series; the steady days read in-band.
    const steady = consecutive([
      70, 71, 69, 70, 72, 68, 70, 71, 69, 70, 71, 70,
    ]);
    const res = detectStreak(steady);
    expect(res.latestPlacement).toBe("in");
    expect(res.streakDays).toBeGreaterThan(0);
  });

  it("omits when there is too little history to build a band", () => {
    // An empty band build returns null → a quiet omit. A single point gives a
    // zero-spread band; supplying no band and one point yields an in placement
    // but never a return. The conservatism we pin is the empty case above; a
    // degenerate one-point series must at least never fabricate a return.
    const res = detectStreak(consecutive([70]));
    expect(res.returnEvent).toBeUndefined();
  });
});
