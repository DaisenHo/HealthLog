import { describe, expect, it } from "vitest";

import {
  auditCRequestSchema,
  factWriteSchema,
  isStoredFactPlaintext,
  lifeAiSectionsPatchSchema,
} from "../life-circumstances";

const tobacco = {
  schema: 1,
  products: ["cigarettes"],
  cigarettesPerDay: 20,
  startYear: 1990,
  quitMonth: "2020-06",
  secondhandSmoke: null,
};

describe("fact writes (v1.43)", () => {
  it("still takes the three closed kinds with their string value", () => {
    expect(
      factWriteSchema.safeParse({ kind: "SMOKING_STATUS", value: "FORMER" })
        .success,
    ).toBe(true);
    expect(
      factWriteSchema.safeParse({ kind: "SMOKING_STATUS", value: "ROTATING" })
        .success,
    ).toBe(false);
  });

  it("takes a life kind with its object value and an optional day", () => {
    const parsed = factWriteSchema.safeParse({
      kind: "TOBACCO_DETAIL",
      value: tobacco,
      validFrom: "2026-03-01",
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses cigarettes per day without cigarettes, and unknown keys", () => {
    expect(
      factWriteSchema.safeParse({
        kind: "TOBACCO_DETAIL",
        value: { ...tobacco, products: ["e_cigarette"] },
      }).success,
    ).toBe(false);
    expect(
      factWriteSchema.safeParse({
        kind: "TOBACCO_DETAIL",
        value: { ...tobacco, packYears: 30 },
      }).success,
    ).toBe(false);
  });

  it("caps the goals at three and the sitting hours at half-hour steps", () => {
    expect(
      factWriteSchema.safeParse({
        kind: "HEALTH_GOALS",
        value: {
          schema: 1,
          goals: ["sleep", "weight", "fitness", "blood_sugar"],
        },
      }).success,
    ).toBe(false);
    expect(
      factWriteSchema.safeParse({
        kind: "ACTIVITY_HABIT",
        value: {
          schema: 1,
          moderateDaysPerWeek: 3,
          moderateMinutesPerDay: 30,
          sittingHoursWorkday: 7.25,
        },
      }).success,
    ).toBe(false);
  });

  it("checks a backup's plaintext the way a write checks the value", () => {
    expect(isStoredFactPlaintext("SHIFT_SCHEDULE", "ROTATING")).toBe(true);
    expect(
      isStoredFactPlaintext("TOBACCO_DETAIL", JSON.stringify(tobacco)),
    ).toBe(true);
    expect(isStoredFactPlaintext("TOBACCO_DETAIL", "{")).toBe(false);
    expect(isStoredFactPlaintext("HABITS", JSON.stringify(tobacco))).toBe(
      false,
    );
  });
});

describe("AI switches and AUDIT-C requests", () => {
  it("needs at least one section", () => {
    expect(lifeAiSectionsPatchSchema.safeParse({ sections: {} }).success).toBe(
      false,
    );
    expect(
      lifeAiSectionsPatchSchema.safeParse({ sections: { HABITS: true } })
        .success,
    ).toBe(true);
  });

  it("takes three items from 0 to 4", () => {
    expect(
      auditCRequestSchema.safeParse({ items: [0, 4, 2], source: "WEB" })
        .success,
    ).toBe(true);
    expect(
      auditCRequestSchema.safeParse({ items: [0, 5, 2], source: "WEB" })
        .success,
    ).toBe(false);
    expect(
      auditCRequestSchema.safeParse({ items: [0, 1], source: "WEB" }).success,
    ).toBe(false);
  });
});
