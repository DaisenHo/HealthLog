/**
 * The medication-effect assembly around the segmented regression: the window,
 * the adherence and not-taking exclusions, the dose-change cut, the confounder
 * list and the minimum-data floor. The regression itself is pinned to
 * reference values in `src/lib/stats/__tests__/segmented-regression.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  buildSegmentedEffect,
  notTakingPredicate,
  type SegmentedEffectInput,
} from "@/lib/medications/efficacy/segmented-effect";

const DAY = 24 * 60 * 60 * 1000;
const PIVOT = "2026-03-01";

function dayAt(offset: number): string {
  return new Date(Date.parse(`${PIVOT}T00:00:00Z`) + offset * DAY)
    .toISOString()
    .slice(0, 10);
}

/** 140 before, a clean −10 shift and −0.7/week (−0.1/day) slope after. */
function series(fromOffset: number, toOffset: number) {
  const out: { day: string; value: number }[] = [];
  for (let t = fromOffset; t <= toOffset; t++) {
    out.push({
      day: dayAt(t),
      value: t < 0 ? 140 : 130 - 0.1 * t,
    });
  }
  return out;
}

function input(over: Partial<SegmentedEffectInput> = {}): SegmentedEffectInput {
  return {
    dayValues: series(-60, 59),
    pivotDay: PIVOT,
    lastDay: dayAt(59),
    adherenceDays: null,
    notTakingOn: () => false,
    ownDoseChangeDays: [],
    otherMedicationEvents: [],
    ...over,
  };
}

describe("buildSegmentedEffect", () => {
  it("recovers the known level and weekly slope change", () => {
    const r = buildSegmentedEffect(input());
    expect(r.present).toBe(true);
    expect(r.levelChange!.estimate).toBeCloseTo(-10, 9);
    expect(r.slopeChangePerWeek!.estimate).toBeCloseTo(-0.7, 9);
    expect(r.preSlopePerWeek!.estimate).toBeCloseTo(0, 9);
    expect(r.days).toEqual({
      before: 60,
      after: 60,
      excludedLowAdherence: 0,
      excludedNotTaking: 0,
    });
    expect(r.window).toEqual({
      from: dayAt(-90),
      to: dayAt(59),
      endReason: "today",
    });
    expect(r.adherence.status).toBe("not_tracked");
    expect(r.level).toBe(0.95);
  });

  it("caps the post window at 180 days", () => {
    const r = buildSegmentedEffect(
      input({ dayValues: series(-30, 300), lastDay: dayAt(300) }),
    );
    expect(r.window).toEqual({
      from: dayAt(-90),
      to: dayAt(179),
      endReason: "window",
    });
    expect(r.days.after).toBe(180);
  });

  it("drops values older than the 90-day pre window", () => {
    const r = buildSegmentedEffect(input({ dayValues: series(-200, 59) }));
    expect(r.days.before).toBe(90);
  });

  it("ends the window the day before the first own dose change", () => {
    const r = buildSegmentedEffect(
      input({ ownDoseChangeDays: [PIVOT, dayAt(40)] }),
    );
    expect(r.window?.to).toBe(dayAt(39));
    expect(r.window?.endReason).toBe("dose_change");
    expect(r.days.after).toBe(40);
  });

  it("leaves out post-start days whose trailing 14-day adherence is below 80 %", () => {
    // One dose a day; every dose from day 20 to day 29 missed.
    const adherenceDays = Array.from({ length: 60 }, (_, t) => ({
      day: dayAt(t),
      taken: t >= 20 && t < 30 ? 0 : 1,
      missed: t >= 20 && t < 30 ? 1 : 0,
    }));
    const r = buildSegmentedEffect(input({ adherenceDays }));
    expect(r.adherence.status).toBe("tracked");
    // Day d is low when misses in [d-13, d] exceed 2 (3/14 = 78.6 %): from
    // day 22 (3 misses) through day 29+13-2 = day 40 (3 misses left).
    expect(r.days.excludedLowAdherence).toBe(19);
    expect(r.days.after).toBe(60 - 19);
    // The fit on the remaining days still recovers the clean effect.
    expect(r.levelChange!.estimate).toBeCloseTo(-10, 9);
  });

  it("treats a lookback without any expected dose as unknown, not low", () => {
    const r = buildSegmentedEffect(input({ adherenceDays: [] }));
    expect(r.days.excludedLowAdherence).toBe(0);
    expect(r.present).toBe(true);
  });

  it("leaves out days the medication was not being taken", () => {
    const r = buildSegmentedEffect(
      input({ notTakingOn: (d) => d >= dayAt(10) && d < dayAt(20) }),
    );
    expect(r.days.excludedNotTaking).toBe(10);
  });

  it("needs 14 days on each side", () => {
    const before = buildSegmentedEffect(input({ dayValues: series(-13, 59) }));
    expect(before.present).toBe(false);
    expect(before.reason).toBe("insufficient_before");
    expect(before.levelChange).toBeNull();
    const after = buildSegmentedEffect(
      input({ dayValues: series(-60, 12), lastDay: dayAt(12) }),
    );
    expect(after.reason).toBe("insufficient_after");
  });

  it("needs each side to span 21 days, not just hold 14 values", () => {
    // 14 consecutive days right before the start: enough values, too short.
    const r = buildSegmentedEffect(input({ dayValues: series(-14, 59) }));
    expect(r.days.before).toBe(14);
    expect(r.reason).toBe("insufficient_before");
  });

  it("answers no_start without a start date", () => {
    const r = buildSegmentedEffect(input({ pivotDay: null }));
    expect(r).toMatchObject({ present: false, reason: "no_start" });
    expect(r.window).toBeNull();
  });

  it("lists only the other medications' changes inside the window, oldest first", () => {
    const r = buildSegmentedEffect(
      input({
        otherMedicationEvents: [
          { medicationName: "B", event: "dose_change", date: dayAt(30) },
          { medicationName: "A", event: "started", date: dayAt(-20) },
          { medicationName: "C", event: "stopped", date: dayAt(-120) },
        ],
      }),
    );
    expect(r.confounders).toEqual([
      { medicationName: "A", event: "started", date: dayAt(-20) },
      { medicationName: "B", event: "dose_change", date: dayAt(30) },
    ]);
  });

  it("flags an interval that spans zero", () => {
    const flat = series(-60, 59).map((p, i) => ({
      day: p.day,
      value: 120 + (i % 2 === 0 ? 3 : -3),
    }));
    const r = buildSegmentedEffect(input({ dayValues: flat }));
    expect(r.present).toBe(true);
    expect(r.levelChange!.includesZero).toBe(true);
  });

  it("flags strong residual autocorrelation for a caveat, not a clean fit", () => {
    // A slow wave around the line: neighbouring residuals share a sign.
    const wavy = series(-60, 59).map((p, i) => ({
      day: p.day,
      value: p.value + 4 * Math.sin(i / 6),
    }));
    const r = buildSegmentedEffect(input({ dayValues: wavy }));
    expect(r.fit!.residualAutocorrelation).toBeGreaterThan(0.5);
    expect(r.fit!.autocorrelationCaveat).toBe(true);
    expect(r.fit!.hacLag).toBe(7);
    // Alternating noise: negative carry-over, no caveat.
    const alternating = series(-60, 59).map((p, i) => ({
      day: p.day,
      value: p.value + (i % 2 === 0 ? 2 : -2),
    }));
    const clean = buildSegmentedEffect(input({ dayValues: alternating }));
    expect(clean.fit!.autocorrelationCaveat).toBe(false);
  });
});

describe("notTakingPredicate", () => {
  it("covers a pause up to the resume day and the gaps between courses", () => {
    const pred = notTakingPredicate(
      {
        pauseEras: [
          {
            pausedAt: new Date("2026-03-10T08:00:00Z"),
            resumedAt: new Date("2026-03-15T08:00:00Z"),
          },
        ],
        courses: [
          {
            startsOn: new Date("2026-03-01T00:00:00Z"),
            endsOn: new Date("2026-03-31T00:00:00Z"),
          },
          {
            startsOn: new Date("2026-05-01T00:00:00Z"),
            endsOn: null,
          },
        ],
      } as never,
      "UTC",
    );
    expect(pred("2026-03-09")).toBe(false);
    expect(pred("2026-03-10")).toBe(true);
    expect(pred("2026-03-14")).toBe(true);
    expect(pred("2026-03-15")).toBe(false);
    expect(pred("2026-04-10")).toBe(true);
    expect(pred("2026-05-02")).toBe(false);
  });
});
