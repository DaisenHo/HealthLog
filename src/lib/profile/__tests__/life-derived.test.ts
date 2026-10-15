import { describe, expect, it } from "vitest";

import {
  activityMinutesPerWeek,
  computePackYears,
  dayTypeForNight,
  isReviewDue,
  screeningHints,
  type ScreeningInputs,
} from "../life-derived";
import type { TobaccoDetailValue } from "@/lib/validations/life-circumstances";

const NOW = new Date("2026-10-16T12:00:00.000Z");

function tobacco(over: Partial<TobaccoDetailValue> = {}): TobaccoDetailValue {
  return {
    schema: 1,
    products: ["cigarettes"],
    cigarettesPerDay: 20,
    startYear: 1990,
    quitMonth: null,
    secondhandSmoke: null,
    ...over,
  };
}

describe("pack-years", () => {
  it("20 a day from 1990 to 2020 is 30.0", () => {
    expect(
      computePackYears("FORMER", tobacco({ quitMonth: "2020-06" }), NOW),
    ).toEqual({ value: 30, status: "computed" });
  });

  it("runs to the current year for a current smoker, to one decimal", () => {
    expect(
      computePackYears("CURRENT", tobacco({ cigarettesPerDay: 15 }), NOW),
    ).toEqual({ value: 27, status: "computed" });
    expect(
      computePackYears(
        "CURRENT",
        tobacco({ cigarettesPerDay: 7, startYear: 2010 }),
        NOW,
      ),
    ).toEqual({ value: 5.6, status: "computed" });
  });

  it("is missing without a start year, never estimated", () => {
    expect(
      computePackYears("CURRENT", tobacco({ startYear: null }), NOW),
    ).toEqual({ value: null, status: "missing_inputs" });
    expect(computePackYears("CURRENT", null, NOW).status).toBe(
      "missing_inputs",
    );
  });

  it("needs the quit date of a former smoker", () => {
    expect(computePackYears("FORMER", tobacco(), NOW).status).toBe(
      "missing_inputs",
    );
  });

  it("does not apply to someone who never smoked or smokes no cigarettes", () => {
    expect(computePackYears("NEVER", tobacco(), NOW).status).toBe(
      "not_applicable",
    );
    expect(
      computePackYears(
        "CURRENT",
        tobacco({ products: ["e_cigarette"], cigarettesPerDay: null }),
        NOW,
      ).status,
    ).toBe("not_applicable");
  });
});

describe("activity minutes", () => {
  it("multiplies the two Exercise Vital Sign answers", () => {
    expect(activityMinutesPerWeek(5, 30)).toEqual({
      value: 150,
      meetsWho150: true,
    });
    expect(activityMinutesPerWeek(2, 30)).toEqual({
      value: 60,
      meetsWho150: false,
    });
  });

  it("stays null with either answer missing", () => {
    expect(activityMinutesPerWeek(null, 30)).toEqual({
      value: null,
      meetsWho150: null,
    });
  });
});

describe("free weekdays per night", () => {
  // 2026-10-13 is a Tuesday, 2026-10-17 a Saturday.
  const spans = [
    {
      validFrom: new Date("2026-10-01T00:00:00.000Z"),
      validUntil: null,
      days: [2, 3],
    },
  ];

  it("reads a night against the answer in force: Tuesday and Wednesday free", () => {
    expect(dayTypeForNight("2026-10-13", spans)).toBe("free");
    expect(dayTypeForNight("2026-10-14", spans)).toBe("free");
    expect(dayTypeForNight("2026-10-17", spans)).toBe("work");
  });

  it("keeps the weekend default for nights before the answer", () => {
    expect(dayTypeForNight("2026-09-26", spans)).toBe("free");
    expect(dayTypeForNight("2026-09-29", spans)).toBe("work");
  });

  it("is the weekend default with no answer at all", () => {
    expect(dayTypeForNight("2026-10-17", [])).toBe("free");
    expect(dayTypeForNight("2026-10-13", [])).toBe("work");
  });
});

describe("review due", () => {
  it("after a year, and never without an answer", () => {
    expect(isReviewDue(new Date("2025-10-15T00:00:00.000Z"), NOW)).toBe(true);
    expect(isReviewDue(new Date("2026-01-01T00:00:00.000Z"), NOW)).toBe(false);
    expect(isReviewDue(null, NOW)).toBe(false);
  });
});

describe("screening hints", () => {
  function input(over: Partial<ScreeningInputs> = {}): ScreeningInputs {
    const detail = over.detail ?? tobacco({ startYear: 1985 });
    return {
      ageYears: 60,
      sex: "MALE",
      smokingStatus: "CURRENT",
      detail,
      packYears: computePackYears(over.smokingStatus ?? "CURRENT", detail, NOW),
      locale: "de",
      now: NOW,
      ...over,
    };
  }

  it("suggests the German low-dose CT with the G-BA source and country", () => {
    const [lung] = screeningHints(input());
    expect(lung.id).toBe("lung_ldct");
    expect(lung.status).toBe("suggested");
    expect(lung.region).toBe("DE");
    expect(lung.sourceLabel).toContain("G-BA");
    expect(lung.sourceLabel).toContain("Deutschland");
    expect(lung.sourceUrl).toMatch(/^https:\/\/www\.g-ba\.de\//);
  });

  it("names the failing criteria", () => {
    const [lung] = screeningHints(
      input({
        ageYears: 45,
        detail: tobacco({ startYear: 2015, cigarettesPerDay: 10 }),
      }),
    );
    expect(lung.status).toBe("not_eligible");
    expect(lung.reasonKeys).toEqual(
      expect.arrayContaining([
        "age_out_of_range",
        "pack_years_below_15",
        "smoked_years_below_25",
      ]),
    );
  });

  it("says unknown, not no, when the birth date is missing", () => {
    const [lung] = screeningHints(input({ ageYears: null }));
    expect(lung.status).toBe("unknown");
    expect(lung.reasonKeys).toContain("missing_birth_date");
  });

  it("uses the US rules outside German, with the country in the account language", () => {
    const [lung, aaa] = screeningHints(input({ locale: "fr" }));
    expect(lung.region).toBe("US");
    expect(lung.sourceLabel).toContain("USPSTF");
    expect(lung.sourceLabel).toContain("États-Unis");
    expect(aaa.status).toBe("not_eligible");
    expect(aaa.reasonKeys).toContain("age_out_of_range");
  });

  it("offers the aorta ultrasound to every man from 65 in Germany, not to women", () => {
    expect(screeningHints(input({ ageYears: 66 }))[1].status).toBe("suggested");
    const women = screeningHints(input({ ageYears: 66, sex: "FEMALE" }))[1];
    expect(women.status).toBe("not_eligible");
    expect(women.reasonKeys).toContain("sex_not_male");
    expect(screeningHints(input({ ageYears: 66, sex: null }))[1].status).toBe(
      "unknown",
    );
  });

  it("asks the US rule for a smoking history", () => {
    const never = screeningHints(
      input({ ageYears: 70, locale: "en", smokingStatus: "NEVER" }),
    );
    expect(never[0].reasonKeys).toEqual(["never_smoked"]);
    expect(never[1].reasonKeys).toContain("never_smoked");
  });
});
