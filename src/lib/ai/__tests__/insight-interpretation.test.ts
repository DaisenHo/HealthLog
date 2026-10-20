/**
 * v1.27.13 — the interpretation registry is the guideline source of
 * truth for the assessment prompt's band placement. These guards PIN the band
 * edges against the knowledge base's stated thresholds, so a silent edit to a
 * clinical number breaks a test rather than shipping. They also lock the
 * band-position classifier's edge semantics (strict `<`, edge-hugging
 * proximity) and the allow-set edge extraction.
 */
import { describe, expect, it } from "vitest";
import {
  classifyBandPosition,
  interpretationBandEdges,
  resolveInterpretation,
} from "@/lib/ai/insight-interpretation";

describe("interpretation registry — pinned band edges (KB-derived)", () => {
  it("visceral fat: healthy < 13, elevated above (consumer rating)", () => {
    const interp = resolveInterpretation("VISCERAL_FAT", null);
    expect(interp).not.toBeNull();
    expect(interp!.directionOfGood).toBe("lower");
    expect(interp!.bands.map((b) => b.upTo)).toEqual([13, null]);
    // The maintainer's headline example: 2.7 is comfortably healthy.
    const pos = classifyBandPosition(2.7, interp!.bands);
    expect(pos.band.label).toBe("healthy");
    expect(pos.band.valence).toBe("favourable");
  });

  it("BMI: WHO adult bands at 18.5 / 25 / 30 / 35 / 40", () => {
    const interp = resolveInterpretation("BMI", null);
    expect(interp!.source).toBe("WHO 2000");
    expect(interp!.bands.map((b) => b.upTo)).toEqual([
      18.5,
      25,
      30,
      35,
      40,
      null,
    ]);
    // 25.0 exactly falls into overweight (strict `<` on the normal edge).
    expect(classifyBandPosition(25, interp!.bands).band.label).toBe(
      "overweight",
    );
    expect(classifyBandPosition(24.9, interp!.bands).band.label).toBe(
      "normal weight",
    );
  });

  it("resting heart rate: 60 / 100 (AHA)", () => {
    const interp = resolveInterpretation("RESTING_HEART_RATE", null);
    expect(interp!.bands.map((b) => b.upTo)).toEqual([60, 100, null]);
  });

  it("SpO₂: significant-low < 90, mild < 95, healthy above", () => {
    const interp = resolveInterpretation("OXYGEN_SATURATION", null);
    expect(interp!.directionOfGood).toBe("higher");
    expect(interp!.bands.map((b) => b.upTo)).toEqual([90, 95, null]);
    expect(classifyBandPosition(97, interp!.bands).band.valence).toBe(
      "favourable",
    );
  });

  it("respiratory rate: 12 / 20 target band", () => {
    const interp = resolveInterpretation("RESPIRATORY_RATE", null);
    expect(interp!.bands.map((b) => b.upTo)).toEqual([12, 20, null]);
  });

  it("body temperature: 35.7 / 37.5 / 38 (fever at FEVER_BAND_C)", () => {
    const interp = resolveInterpretation("BODY_TEMPERATURE", null);
    expect(interp!.bands.map((b) => b.upTo)).toEqual([35.7, 37.5, 38, null]);
    expect(classifyBandPosition(38.4, interp!.bands).band.label).toBe(
      "fever range",
    );
  });

  it("sleep duration: recommended adult range 420–540 min", () => {
    const interp = resolveInterpretation("SLEEP_DURATION", null);
    expect(interp!.bands.map((b) => b.upTo)).toEqual([420, 540, null]);
  });

  it("waist circumference: sex-split (men 94/102, women 80/88)", () => {
    const male = resolveInterpretation("WAIST_CIRCUMFERENCE", "MALE");
    expect(male!.bands.map((b) => b.upTo)).toEqual([94, 102, null]);
    const female = resolveInterpretation("WAIST_CIRCUMFERENCE", "FEMALE");
    expect(female!.bands.map((b) => b.upTo)).toEqual([80, 88, null]);
    // Unknown sex → no interpretation (fail-soft, never guesses a sex).
    expect(resolveInterpretation("WAIST_CIRCUMFERENCE", null)).toBeNull();
  });

  it("waist-to-height: increased risk at 0.5 (NICE)", () => {
    const interp = resolveInterpretation("WAIST_TO_HEIGHT", null);
    expect(interp!.bands.map((b) => b.upTo)).toEqual([0.5, null]);
  });

  it("pulse-wave velocity: reference threshold 10 m/s (ESC/ESH 2018)", () => {
    const interp = resolveInterpretation("PULSE_WAVE_VELOCITY", null);
    expect(interp!.bands.map((b) => b.upTo)).toEqual([10, null]);
    expect(interp!.caveat).toContain("proxy");
  });

  it("uncovered metrics have no interpretation (stay personal-relative)", () => {
    // HRV + glucose are deliberately NOT registered (the KB warns wearable HRV
    // is not the clinical SDNN band; glucose bands are meal-context-dependent).
    expect(resolveInterpretation("HEART_RATE_VARIABILITY", null)).toBeNull();
    expect(resolveInterpretation("BLOOD_GLUCOSE", null)).toBeNull();
    expect(resolveInterpretation("NOT_A_METRIC", null)).toBeNull();
  });
});

describe("classifyBandPosition — edge semantics + proximity", () => {
  it("flags a value hugging the upper boundary of a bounded band", () => {
    const interp = resolveInterpretation("RESPIRATORY_RATE", null);
    // 19.5 in the 12–20 band sits within 20% of the upper edge (width 8,
    // margin 1.6): distance to 20 is 0.5 → near-upper-edge.
    const pos = classifyBandPosition(19.5, interp!.bands);
    expect(pos.band.label).toBe("the normal resting range");
    expect(pos.proximity).toBe("near-upper-edge");
    expect(pos.nearestEdge).toBe(20);
  });

  it("reports central placement deep inside a band", () => {
    const interp = resolveInterpretation("RESPIRATORY_RATE", null);
    const pos = classifyBandPosition(16, interp!.bands);
    expect(pos.proximity).toBe("central");
  });
});

describe("interpretationBandEdges — grounding allow-set", () => {
  it("returns exactly the finite band edges for a covered metric", () => {
    expect(
      interpretationBandEdges("VISCERAL_FAT").sort((a, b) => a - b),
    ).toEqual([13]);
    expect(interpretationBandEdges("BMI").sort((a, b) => a - b)).toEqual([
      18.5, 25, 30, 35, 40,
    ]);
  });

  it("unions both sex band sets when the sex is unknown", () => {
    expect(
      interpretationBandEdges("WAIST_CIRCUMFERENCE").sort((a, b) => a - b),
    ).toEqual([80, 88, 94, 102]);
    expect(
      interpretationBandEdges("WAIST_CIRCUMFERENCE", "MALE").sort(
        (a, b) => a - b,
      ),
    ).toEqual([94, 102]);
  });

  it("returns [] for an uncovered metric", () => {
    expect(interpretationBandEdges("HEART_RATE_VARIABILITY")).toEqual([]);
  });
});
