import { describe, expect, it } from "vitest";

import { getServerTranslator } from "@/lib/i18n/server-translator";
import { locales as LOCALES } from "@/lib/i18n/config";

import { resolveSeriesReferenceLines } from "../series-reference-lines";

const en = getServerTranslator("en");
const NO_PROFILE = { dateOfBirth: null, gender: null, heightCm: null };
const MAN_41 = {
  dateOfBirth: new Date("1985-01-01T00:00:00.000Z"),
  gender: "MALE",
  heightCm: 180,
};

function lines(
  kind: Parameters<typeof resolveSeriesReferenceLines>[0],
  opts: {
    profile?: typeof NO_PROFILE | typeof MAN_41;
    thresholdsJson?: unknown;
    glucoseUnit?: "mg/dL" | "mmol/L";
  } = {},
) {
  return resolveSeriesReferenceLines(kind, {
    profile: opts.profile ?? NO_PROFILE,
    thresholdsJson: opts.thresholdsJson ?? null,
    glucoseUnit: opts.glucoseUnit ?? "mg/dL",
    t: (key) => en.t(key),
  });
}

describe("resolveSeriesReferenceLines", () => {
  it("draws glucose 70 / 180 mg/dL, converted for an mmol/L account", () => {
    expect(lines("glucose").map((l) => [l.kind, l.value])).toEqual([
      ["lower", 70],
      ["upper", 180],
    ]);
    expect(
      lines("glucose", { glucoseUnit: "mmol/L" }).map((l) => [l.kind, l.value]),
    ).toEqual([
      ["lower", 3.9],
      ["upper", 10],
    ]);
  });

  it("draws the ESH 140 / 90 lines without a profile or a target", () => {
    expect(
      lines("bloodPressure").map((l) => [
        l.appliesTo,
        l.kind,
        l.value,
        l.source,
      ]),
    ).toEqual([
      ["value", "upper", 140, "clinical"],
      ["secondary", "upper", 90, "clinical"],
    ]);
  });

  it("replaces the clinical edge with the person's band", () => {
    const own = lines("bloodPressure", {
      thresholdsJson: { BLOOD_PRESSURE_SYS: { min: 115, max: 125 } },
    });
    expect(own.map((l) => [l.appliesTo, l.kind, l.value, l.source])).toEqual([
      ["value", "lower", 115, "personal"],
      ["value", "upper", 125, "personal"],
      ["secondary", "upper", 90, "clinical"],
    ]);
    // An age turns the diastolic side into the profile band too.
    const aged = lines("bloodPressure", { profile: MAN_41 });
    expect(aged.every((l) => l.source === "personal")).toBe(true);
    expect(aged.map((l) => l.value)).toEqual([120, 129, 70, 79]);
  });

  it("draws the SpO2 floor, or the person's band instead", () => {
    expect(lines("oxygenSaturation")).toMatchObject([
      { value: 92, kind: "lower", source: "clinical" },
    ]);
    expect(
      lines("oxygenSaturation", {
        thresholdsJson: { OXYGEN_SATURATION: { min: 90, max: 96 } },
      }).map((l) => l.value),
    ).toEqual([90, 96]);
  });

  it("draws the resting band on the resting chart only", () => {
    expect(lines("restingHeartRate", { profile: MAN_41 })).toHaveLength(2);
    expect(lines("pulse", { profile: MAN_41 })).toEqual([]);
  });

  it("is empty when there is nothing to draw", () => {
    expect(lines("heartRateVariability")).toEqual([]);
    expect(lines("steps")).toEqual([]);
    expect(lines("weight", { profile: MAN_41 })).toEqual([]);
  });

  it("names every label key in every bundle, and labels in the account language", () => {
    const keys = new Set([
      ...lines("bloodPressure").map((l) => l.labelKey),
      ...lines("bloodPressure", { profile: MAN_41 }).map((l) => l.labelKey),
      ...lines("glucose").map((l) => l.labelKey),
    ]);
    expect(keys.size).toBe(4);
    for (const locale of LOCALES) {
      const t = getServerTranslator(locale);
      for (const key of keys) expect(t.t(key)).not.toBe(key);
    }
    const de = getServerTranslator("de");
    const german = resolveSeriesReferenceLines("glucose", {
      profile: NO_PROFILE,
      thresholdsJson: null,
      glucoseUnit: "mg/dL",
      t: (key) => de.t(key),
    });
    expect(german[0].label).toBe("Klinische Untergrenze");
  });
});
