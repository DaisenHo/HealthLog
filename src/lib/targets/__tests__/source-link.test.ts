import { describe, it, expect } from "vitest";

import { getTargetSourceLink } from "../source-link";

/**
 * v1.8.5 — `getTargetSourceLink` was extracted from the Targets page
 * so both the Targets card and the Insights reference panel resolve the
 * identical guideline-citation URL. These tests pin the type → URL map
 * and the pulse source-substring branching.
 */
describe("getTargetSourceLink", () => {
  it("maps weight + BMI to the WHO obesity fact-sheet", () => {
    const url =
      "https://www.who.int/news-room/fact-sheets/detail/obesity-and-overweight";
    expect(getTargetSourceLink({ type: "WEIGHT", source: "WHO BMI" })).toBe(
      url,
    );
    expect(getTargetSourceLink({ type: "BMI", source: "WHO BMI" })).toBe(url);
  });

  it("maps blood pressure (and the in-target derivative) to the ESH paper", () => {
    const url = "https://academic.oup.com/eurheartj/article/39/33/3021/5079119";
    expect(
      getTargetSourceLink({ type: "BLOOD_PRESSURE", source: "ESH 2023" }),
    ).toBe(url);
    expect(
      getTargetSourceLink({
        type: "BLOOD_PRESSURE_IN_TARGET",
        source: "ESH 2023",
      }),
    ).toBe(url);
  });

  it("branches the pulse link on the source substring", () => {
    expect(
      getTargetSourceLink({ type: "PULSE", source: "CDC/NCHS 2011" }),
    ).toBe("https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf");
    expect(getTargetSourceLink({ type: "PULSE", source: "AHA" })).toBe(
      "https://www.heart.org/en/health-topics/high-blood-pressure/the-facts-about-high-blood-pressure/all-about-heart-rate-pulse",
    );
    // An unrecognised pulse source resolves to no link rather than a wrong one.
    expect(getTargetSourceLink({ type: "PULSE", source: "Karvonen" })).toBe(
      null,
    );
  });

  it("maps sleep, body fat, and steps to their respective guidelines", () => {
    expect(
      getTargetSourceLink({ type: "SLEEP_DURATION", source: "AASM" }),
    ).toContain("aasm.org");
    expect(getTargetSourceLink({ type: "BODY_FAT", source: "ACE" })).toContain(
      "acefitness.org",
    );
    expect(
      getTargetSourceLink({ type: "ACTIVITY_STEPS", source: "WHO" }),
    ).toContain("who.int/publications");
  });

  it("returns null for a type without a guideline citation", () => {
    expect(
      getTargetSourceLink({ type: "MEDICATION_COMPLIANCE", source: "—" }),
    ).toBe(null);
    expect(
      getTargetSourceLink({ type: "BLOOD_GLUCOSE_FASTING", source: "ADA" }),
    ).toBe(null);
  });
});
