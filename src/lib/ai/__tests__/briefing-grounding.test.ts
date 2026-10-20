import { describe, it, expect } from "vitest";

import {
  findUngroundedBriefingNumbers,
  readBriefingBlock,
  buildBriefingGroundingCorrection,
  extractNumbers,
} from "@/lib/ai/briefing-grounding";
import type { SignalOfDay } from "@/lib/insights/features";

function signal(partial: Partial<SignalOfDay>): SignalOfDay {
  return {
    metric: "weight",
    label: "Weight",
    latest: 82,
    latestDaysAgo: 0,
    avg7: 83,
    avg30: 84,
    deltaVs7: -1,
    deltaVs30: -2,
    spread30: 0.5,
    outsideNormalSwing: true,
    emergingTrend: "falling",
    recentAnomaly: null,
    ...partial,
  };
}

describe("extractNumbers", () => {
  it("parses signed, decimal, and comma-decimal numbers", () => {
    expect(
      extractNumbers("dropped 2.5 kg, +1,2 and -3").map((n) => n.value),
    ).toEqual([2.5, 1.2, -3]);
  });
});

describe("findUngroundedBriefingNumbers", () => {
  const signals = [signal({})];

  it("returns nothing when there are no signals to grade against", () => {
    const out = findUngroundedBriefingNumbers(
      { paragraph: "your weight dropped 9.9 kg" },
      null,
    );
    expect(out).toEqual([]);
  });

  it("passes a paragraph whose numbers match the signal figures", () => {
    const out = findUngroundedBriefingNumbers(
      {
        paragraph: "Your weight is 82 kg, down 2 kg from your monthly average.",
      },
      signals,
    );
    expect(out).toEqual([]);
  });

  it("flags a fabricated delta that no signal supports", () => {
    const out = findUngroundedBriefingNumbers(
      {
        paragraph: "Your weight dropped 6.4 kg this week.",
        signalsOfDay: [
          { headline: "down 6.4 kg", nudge: "keep going", delta: "-6.4 kg" },
        ],
      },
      signals,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((f) => f.value === 6.4)).toBe(true);
  });

  it("tolerates rounding within the band", () => {
    const out = findUngroundedBriefingNumbers(
      { paragraph: "down 2.1 kg vs your 84.0 average" },
      [signal({ avg30: 84, deltaVs30: -2 })],
    );
    expect(out).toEqual([]);
  });

  it("does not flag structural integers like a 7-day window or 3 signals", () => {
    const out = findUngroundedBriefingNumbers(
      { paragraph: "Over the last 7 days, your 3 readings held steady." },
      signals,
    );
    expect(out).toEqual([]);
  });

  it("returns nothing when the briefing is absent", () => {
    expect(findUngroundedBriefingNumbers(null, signals)).toEqual([]);
  });
});

describe("readBriefingBlock", () => {
  it("reads the dailyBriefing block off a parsed payload", () => {
    const block = readBriefingBlock({ dailyBriefing: { paragraph: "hi" } });
    expect(block?.paragraph).toBe("hi");
  });
  it("returns null when no briefing is present", () => {
    expect(readBriefingBlock({ summary: "x" })).toBeNull();
    expect(readBriefingBlock(null)).toBeNull();
  });
});

describe("buildBriefingGroundingCorrection", () => {
  it("names the offending numbers and asks for a re-write", () => {
    const msg = buildBriefingGroundingCorrection([
      { field: "paragraph", value: 7, source: "7 kg" },
    ]);
    expect(msg).toContain("7 kg");
    expect(msg.toLowerCase()).toContain("signalsofday");
  });
});

// v1.22 (W6, W8 seam) — the allow-set now also admits numbers from the W8
// aggregate blocks (glucose / labs / preventive-care / workouts) so the model
// may cite them, while still rejecting genuinely ungrounded values.
describe("W8 aggregate-block grounding extension", () => {
  const signals = [signal({})];

  it("flags a glucose figure when only signals are passed (not in signalsOfDay)", () => {
    const found = findUngroundedBriefingNumbers(
      { paragraph: "Your glucose has averaged 118 mg/dL this month." },
      signals,
    );
    expect(found.map((f) => f.value)).toContain(118);
  });

  it("admits the same glucose figure once the features block is passed", () => {
    const found = findUngroundedBriefingNumbers(
      { paragraph: "Your glucose has averaged 118 mg/dL this month." },
      signals,
      {
        glucose: {
          avg7: 120,
          avg30: 118,
          avg90: 115,
          latest: 119,
          latestDaysAgo: 0,
          slope30: 0.1,
          coverage: {} as never,
        },
      } as never,
    );
    expect(found).toEqual([]);
  });

  it("admits a flagged lab value + a workout count from the features block", () => {
    const found = findUngroundedBriefingNumbers(
      {
        paragraph:
          "Your LDL came back at 161, and you logged 5 workouts this week.",
      },
      signals,
      {
        labs: {
          flagged: [
            {
              analyte: "LDL",
              value: 161,
              valueText: null,
              unit: "mg/dL",
              rangeStatus: "above",
              trend: null,
              takenAt: "2026-06-01",
              daysAgo: 5,
            },
          ],
          flaggedCount: 1,
        },
        workouts: {
          last7: { count: 5, totalDurationMin: 220, totalDistanceKm: 30 },
          last30: { count: 18, totalDurationMin: 800, totalDistanceKm: 120 },
          latest: null,
        },
      } as never,
    );
    expect(found).toEqual([]);
  });

  it("still flags a fabricated number absent from every block", () => {
    const found = findUngroundedBriefingNumbers(
      { paragraph: "Your glucose hit 250 mg/dL." },
      signals,
      {
        glucose: {
          avg7: 120,
          avg30: 118,
          avg90: 115,
          latest: 119,
          latestDaysAgo: 0,
          slope30: 0.1,
          coverage: {} as never,
        },
      } as never,
    );
    expect(found.map((f) => f.value)).toContain(250);
  });
});

// v1.25.13 — the allow-set previously omitted the CORE vitals blocks (weight,
// blood pressure, pulse, mood, sleep, …) even though the briefing prompt is fed
// all of them. A verdict-first briefing that restated a blood-pressure average
// or a resting pulse — figures every BP-tracking user has — tripped the gate and
// got the WHOLE dailyBriefing stripped to null while the rest of the insight
// refreshed. These lock in that those figures are now grounded.
describe("core-vitals grounding extension", () => {
  const signals = [signal({})];

  it("flags blood-pressure + pulse figures when only signals are passed", () => {
    const found = findUngroundedBriefingNumbers(
      {
        paragraph:
          "Your blood pressure has averaged 128/82 with a resting pulse near 68.",
      },
      signals,
    );
    // Without the features block these are ungrounded (the pre-fix strip).
    // (82 is omitted from the assertion — it collides with the default weight
    // signal's `latest: 82`, so it grounds coincidentally; 128 + 68 do not.)
    expect(found.map((f) => f.value)).toEqual(
      expect.arrayContaining([128, 68]),
    );
  });

  it("admits blood-pressure + pulse averages once the features block is passed", () => {
    const found = findUngroundedBriefingNumbers(
      {
        paragraph:
          "Your blood pressure has averaged 128/82 with a resting pulse near 68.",
      },
      signals,
      {
        bloodPressure: { avgSys30: 128, avgDia30: 82 },
        pulse: { avg30: 68 },
      } as never,
    );
    expect(found).toEqual([]);
  });

  it("admits weight, mood and sleep means from the features block", () => {
    const found = findUngroundedBriefingNumbers(
      {
        paragraph:
          "Weight sits at 84.5 kg, your mood averaged 3.8 and you slept 7.2 hours.",
      },
      signals,
      {
        weight: { latest: 84.5, bmi: 26.1 },
        mood: { avg30: 3.8 },
        sleep: { avg7: 7.2 },
      } as never,
    );
    expect(found).toEqual([]);
  });

  it("still flags a genuinely fabricated vital absent from every block", () => {
    const found = findUngroundedBriefingNumbers(
      { paragraph: "Your systolic spiked to 195 overnight." },
      signals,
      { bloodPressure: { avgSys30: 128, avgDia30: 82 } } as never,
    );
    expect(found.map((f) => f.value)).toContain(195);
  });

  // The ECG device-verdict descriptor feeds the narrative; its
  // server-computed counts must be admitted so a device-attributed sentence
  // ("your device logged 5 ECG recordings") is not stripped by the gate, while
  // a count the block never produced still trips it.
  const ecgFeatures = {
    ecg: {
      recordingCount: 5,
      deviceVerdicts: { irregular: 2, notDetected: 3, inconclusive: 0 },
      latestDeviceVerdict: "IRREGULAR",
      latestRecordedDaysAgo: 4,
      latestAverageHeartRate: 61,
    },
  } as never;

  it("grounds a restated ECG recording count + latest device figures", () => {
    const found = findUngroundedBriefingNumbers(
      {
        paragraph:
          "Your device logged 5 ECG recordings this month; the latest, 4 days ago, averaged 61 bpm.",
      },
      signals,
      ecgFeatures,
    );
    expect(found).toEqual([]);
  });

  it("flags an ECG count the descriptor never produced", () => {
    const found = findUngroundedBriefingNumbers(
      { paragraph: "Your device logged 12 ECG recordings this month." },
      signals,
      ecgFeatures,
    );
    expect(found.map((f) => f.value)).toContain(12);
  });
});
