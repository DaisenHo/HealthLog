import { describe, expect, it } from "vitest";

import {
  resolvePersonalBand,
  resolveSummaryVerdicts,
  resolveTrendVerdict,
  trendSentimentOf,
  trendSentimentOfTrend,
} from "../trend-verdict";

const NO_PROFILE = { dateOfBirth: null, gender: null, heightCm: null };
const MAN_41 = {
  dateOfBirth: new Date("1985-01-01T00:00:00.000Z"),
  gender: "MALE",
  heightCm: 180,
};
const OWN_BP = { BLOOD_PRESSURE_SYS: { min: 115, max: 125 } };

function verdict(
  key: string,
  referenceValue: number | null,
  thresholdsJson: unknown = null,
  profile: typeof NO_PROFILE | typeof MAN_41 = NO_PROFILE,
) {
  return resolveTrendVerdict(key, { profile, thresholdsJson, referenceValue });
}

describe("resolveTrendVerdict against the person's own target", () => {
  it("calls a rising blood pressure above the target a setback", () => {
    const v = verdict("BLOOD_PRESSURE_SYS", 132, OWN_BP);
    expect(v).toEqual({
      direction: "up-bad",
      targetPosition: "above",
      basis: "personal_target",
    });
    expect(trendSentimentOf(4, v)).toBe("negative");
  });

  it("calls the same rise below the target progress", () => {
    const v = verdict("BLOOD_PRESSURE_SYS", 108, OWN_BP);
    expect(v).toEqual({
      direction: "up-good",
      targetPosition: "below",
      basis: "personal_target",
    });
    expect(trendSentimentOf(4, v)).toBe("positive");
  });

  it("holds inside the target, with the edges counted as inside", () => {
    expect(verdict("BLOOD_PRESSURE_SYS", 125, OWN_BP)).toMatchObject({
      direction: "hold",
      targetPosition: "inside",
    });
    const v = verdict("BLOOD_PRESSURE_SYS", 120, OWN_BP);
    expect(trendSentimentOf(0, v)).toBe("positive");
    expect(trendSentimentOf(3, v)).toBe("neutral");
  });

  it("judges the BLOOD_PRESSURE target tile by the systolic band", () => {
    expect(verdict("BLOOD_PRESSURE", 132, OWN_BP).direction).toBe("up-bad");
  });

  it("reads a sleep target in hours against a reference in minutes", () => {
    const own = { SLEEP_DURATION: { min: 7, max: 8 } };
    expect(verdict("SLEEP_DURATION", 6 * 60, own)).toMatchObject({
      direction: "up-good",
      targetPosition: "below",
    });
    expect(verdict("SLEEP_DURATION", 7.5 * 60, own).direction).toBe("hold");
  });

  it("ignores a malformed target and falls back", () => {
    expect(
      verdict("BLOOD_PRESSURE_SYS", 132, {
        BLOOD_PRESSURE_SYS: { min: 130, max: 120 },
      }),
    ).toEqual({
      direction: "up-bad",
      targetPosition: null,
      basis: "metric_default",
    });
  });
});

describe("resolveTrendVerdict against a profile default", () => {
  it("uses the age-based blood pressure band", () => {
    expect(verdict("BLOOD_PRESSURE_SYS", 125, null, MAN_41)).toEqual({
      direction: "hold",
      targetPosition: "inside",
      basis: "profile_default",
    });
  });

  it("uses the age- and sex-based resting pulse band for both pulse keys", () => {
    for (const key of ["PULSE", "RESTING_HEART_RATE"]) {
      expect(verdict(key, 95, null, MAN_41)).toMatchObject({
        direction: "up-bad",
        targetPosition: "above",
        basis: "profile_default",
      });
    }
  });

  it("does not call a band nobody is personalised for a profile default", () => {
    // No age: the pulse band is the same for everyone.
    expect(verdict("RESTING_HEART_RATE", 95)).toEqual({
      direction: "up-bad",
      targetPosition: null,
      basis: "metric_default",
    });
    // No sex: no body fat band.
    expect(verdict("BODY_FAT", 30).basis).toBe("metric_default");
  });

  it("prefers the person's own target over the profile default", () => {
    expect(verdict("BLOOD_PRESSURE_SYS", 125, OWN_BP, MAN_41).basis).toBe(
      "personal_target",
    );
  });
});

describe("resolveTrendVerdict metric defaults", () => {
  it.each([
    ["ACTIVITY_STEPS", "up-good"],
    ["HEART_RATE_VARIABILITY", "up-good"],
    ["HRV_RMSSD", "up-good"],
    ["VO2_MAX", "up-good"],
    ["MOOD", "up-good"],
    ["BODY_FAT", "up-bad"],
    ["RESTING_HEART_RATE", "up-bad"],
    ["RESPIRATORY_RATE", "neutral"],
    ["TOTAL_BODY_WATER", "neutral"],
    ["BLOOD_GLUCOSE_FASTING", "neutral"],
  ])("%s defaults to %s", (key, direction) => {
    expect(verdict(key, null)).toEqual({
      direction,
      targetPosition: null,
      basis: "metric_default",
    });
  });

  it("keeps weight's own rule: only a stored target counts", () => {
    expect(verdict("WEIGHT", 70, null, MAN_41)).toEqual({
      direction: "up-bad",
      targetPosition: null,
      basis: "metric_default",
    });
    expect(verdict("WEIGHT", 60, { WEIGHT: { min: 65, max: 72 } })).toEqual({
      direction: "up-good",
      targetPosition: "below",
      basis: "personal_target",
    });
    // BMI follows the weight it is derived from.
    expect(verdict("BMI", 60, { WEIGHT: { min: 65, max: 72 } }).direction).toBe(
      "up-good",
    );
  });
});

describe("trend sentiment", () => {
  it("applies the noise floor and treats no verdict as neutral", () => {
    const upBad = verdict("RESTING_HEART_RATE", null);
    expect(trendSentimentOf(0.01, upBad)).toBe("neutral");
    expect(trendSentimentOf(-2, upBad)).toBe("positive");
    expect(trendSentimentOf(2, null)).toBe("neutral");
  });

  it("reads a trend word the way it reads a signed change", () => {
    const upGood = verdict("ACTIVITY_STEPS", null);
    expect(trendSentimentOfTrend("up", upGood)).toBe("positive");
    expect(trendSentimentOfTrend("down", upGood)).toBe("negative");
    expect(trendSentimentOfTrend("flat", upGood)).toBe("neutral");
    expect(trendSentimentOfTrend("unknown", upGood)).toBe("neutral");
    expect(trendSentimentOfTrend(null, upGood)).toBe("neutral");
    const hold = verdict("BLOOD_PRESSURE_SYS", 120, OWN_BP);
    expect(trendSentimentOfTrend("stable", hold)).toBe("positive");
  });
});

describe("resolvePersonalBand", () => {
  it("is null when neither an own target nor a personalised default exists", () => {
    expect(resolvePersonalBand("ACTIVITY_STEPS", NO_PROFILE, null)).toBeNull();
    expect(resolvePersonalBand("BLOOD_PRESSURE_DIA", MAN_41, null)).toEqual({
      band: { min: 70, max: 79 },
      basis: "profile_default",
    });
  });
});

describe("resolveSummaryVerdicts", () => {
  it("places each tile's seven-day average and adds the summaryless keys", () => {
    const out = resolveSummaryVerdicts(
      {
        BLOOD_PRESSURE_SYS: { avg7: 132, latest: 118 },
        ACTIVITY_STEPS: { avg7: null, latest: 9000 },
      },
      { profile: NO_PROFILE, thresholdsJson: OWN_BP },
    );
    expect(out.BLOOD_PRESSURE_SYS.direction).toBe("up-bad");
    expect(out.ACTIVITY_STEPS.direction).toBe("up-good");
    expect(out.MOOD.direction).toBe("up-good");
    expect(out.BLOOD_PRESSURE_IN_TARGET.direction).toBe("up-good");
  });
});
