import { describe, expect, it } from "vitest";
import { getBaseSystemPrompt } from "../base-system";
import {
  getMetricArchetypeSystemPrompt,
  getMetricArchetypeUserPrompt,
} from "../metric-archetypes";
import { getBloodPressureUserPrompt } from "../blood-pressure";
import { getWeightUserPrompt } from "../weight";
import { getPulseUserPrompt } from "../pulse";
import { getBmiUserPrompt } from "../bmi";
import { getMoodUserPrompt } from "../mood";
import { getMedicationComplianceUserPrompt } from "../medication-compliance";
import { getGeneralStatusUserPrompt } from "../general-status";
import { getMetricStatusMeta } from "@/lib/insights/metric-status-registry";

/**
 * v1.12.1 — the per-metric assessment prompt gains diversity / anti-
 * repetition affordances (skip-the-step, few-shot, variety/relations
 * context). These tests pin BOTH the NEW behaviour and the UNCHANGED
 * grounding + filler-ban contracts so a future rewrite can't silently
 * regress either axis.
 */

describe("base-system assessment prompt — grounding floor preserved", () => {
  for (const locale of ["en", "de"] as const) {
    it(`${locale}: keeps own-baseline grounding (not population norms)`, () => {
      const p = getBaseSystemPrompt(locale);
      if (locale === "en") {
        expect(p).toMatch(/own baseline/i);
        expect(p).toMatch(/never against a population norm/i);
        // v1.13.x — the normal-swing verdict is now a pre-computed boolean the
        // prompt leads from; the grounding floor is that an in-swing value is
        // explicitly NOT a finding (phrased against `outsideNormalSwing`).
        expect(p).toMatch(/outsideNormalSwing: false.*not a finding/i);
      } else {
        expect(p).toMatch(/EIGENE Baseline/);
        expect(p).toMatch(/nicht gegen Bevölkerungsnormen/i);
        expect(p).toMatch(/outsideNormalSwing: false.*kein Befund/i);
      }
    });

    it(`${locale}: keeps the filler-phrase ban`, () => {
      const p = getBaseSystemPrompt(locale);
      // v1.18.7 — the filler ban is now sourced from the single shared
      // contract fragment ("FORBIDDEN FILLER"); the banned-phrase list is
      // preserved verbatim.
      if (locale === "en") {
        expect(p).toMatch(/FORBIDDEN FILLER/);
        expect(p).toContain("make sure to get enough sleep");
        expect(p).toContain("consult your doctor");
      } else {
        expect(p).toMatch(/VERBOTENE FLOSKELN/);
        expect(p).toContain("achte auf ausreichend Schlaf");
      }
    });

    it(`${locale}: keeps the correlation guard (|r|>0.4, association not cause)`, () => {
      const p = getBaseSystemPrompt(locale);
      expect(p).toContain("0.4");
      if (locale === "en") {
        expect(p).toMatch(/association.*never a "cause"/i);
      } else {
        expect(p).toMatch(/Zusammenhang.*nie als "Ursache"/i);
      }
    });
  }
});

describe("base-system assessment prompt — D1: step is now skippable", () => {
  it("English: instructs to skip a manufactured step when nothing is actionable", () => {
    const p = getBaseSystemPrompt("en");
    expect(p).toMatch(/do NOT manufacture a step/i);
    expect(p).toMatch(/fabricated step is exactly the platitude/i);
  });

  it("German: instructs to skip a forced step when nothing is actionable", () => {
    const p = getBaseSystemPrompt("de");
    expect(p).toMatch(/ERZWINGE KEINEN Schritt/);
    expect(p).toMatch(/erfundener Schritt/i);
  });
});

describe("base-system assessment prompt — V2: few-shot examples present", () => {
  it("English: carries a GOOD grounded example and a BAD banned-filler counter-example", () => {
    const p = getBaseSystemPrompt("en");
    expect(p).toMatch(/EXAMPLES/);
    // v1.22 — the examples now illustrate DIFFERENT shapes (verdict-led,
    // trend-led, one-liner) instead of a single "GOOD" shape.
    expect(p).toMatch(/VERDICT-LED/);
    expect(p).toMatch(/ONE-LINER/);
    expect(p).toMatch(/BAD/);
    // The counter-example deliberately contains a banned phrase, labelled
    // "do NOT write this" so the model learns the failure form.
    expect(p).toMatch(/do NOT write this/i);
  });

  it("German: carries grounded + counter examples", () => {
    const p = getBaseSystemPrompt("de");
    expect(p).toMatch(/BEISPIELE/);
    expect(p).toMatch(/URTEIL-ZUERST/);
    expect(p).toMatch(/EINZEILER/);
    expect(p).toMatch(/SCHLECHT/);
    expect(p).toMatch(/so NICHT/i);
  });
});

describe("metric-archetype user prompt — context block plumbing", () => {
  const meta = getMetricStatusMeta("RESTING_HEART_RATE")!;

  it("appends the assessment-context block when provided", () => {
    const out = getMetricArchetypeUserPrompt(
      meta,
      "{}",
      "2026-06-05",
      "en",
      "",
      "VARIETY: lead with the trend.\n\nRELATIONS: a relation.",
    );
    expect(out).toContain("VARIETY: lead with the trend.");
    expect(out).toContain("RELATIONS: a relation.");
  });

  it("omits the block cleanly when empty (no dangling separators)", () => {
    const out = getMetricArchetypeUserPrompt(meta, "{}", "2026-06-05", "en");
    expect(out).not.toContain("VARIETY");
    expect(out).not.toContain("undefined");
  });

  it("appends the interpretation block when provided (Welle J)", () => {
    const out = getMetricArchetypeUserPrompt(
      meta,
      "{}",
      "2026-06-05",
      "en",
      "",
      "",
      "INTERPRETATION CONTEXT (guideline bands): the healthy band.",
    );
    expect(out).toContain("INTERPRETATION CONTEXT");
  });

  it("omits the interpretation block cleanly when absent", () => {
    const out = getMetricArchetypeUserPrompt(meta, "{}", "2026-06-05", "en");
    expect(out).not.toContain("INTERPRETATION CONTEXT");
    expect(out).not.toContain("undefined");
  });

  it("makes the closing step conditional in the user instruction (both locales)", () => {
    expect(
      getMetricArchetypeUserPrompt(meta, "{}", "2026-06-05", "en"),
    ).toMatch(/when nothing is, skip the step/i);
    expect(
      getMetricArchetypeUserPrompt(meta, "{}", "2026-06-05", "de"),
    ).toMatch(/lass den Schritt weg/i);
  });
});

/**
 * v1.28.40 — the verdict-first rewrite. Every per-metric USER prompt must now
 * LEAD with meaning (verdict-first) and STOP instructing the model to open on a
 * concrete number, and must carry the opener-hint rotation. These pin both the
 * new opening posture and the removal of the old "name the current level with a
 * concrete number" instruction, in EN and DE, for all seven builders + the
 * overall assessment — the exact drift the audit isolated as the tone split.
 */
describe("v1.28.40 per-metric user prompts — verdict-first, number-as-support", () => {
  const meta = getMetricStatusMeta("RESTING_HEART_RATE")!;

  // A builder normalised to `(locale, openerHint?) => prompt` so the parametric
  // assertions below can drive every surface through one shape.
  const BUILDERS: Record<
    string,
    (locale: "en" | "de", openerHint?: string) => string
  > = {
    "metric-archetype": (l, h) =>
      getMetricArchetypeUserPrompt(meta, "{}", "2026-06-05", l, "", "", "", h),
    "blood-pressure": (l, h) =>
      getBloodPressureUserPrompt("{}", "2026-06-05", l, "", "", h),
    weight: (l, h) => getWeightUserPrompt("{}", "2026-06-05", l, "", "", h),
    pulse: (l, h) => getPulseUserPrompt("{}", "2026-06-05", l, "", "", h),
    bmi: (l, h) => getBmiUserPrompt("{}", "2026-06-05", l, "", "", h),
    mood: (l, h) => getMoodUserPrompt("{}", "2026-06-05", l, "", "", h),
    "medication-compliance": (l, h) =>
      getMedicationComplianceUserPrompt("{}", "2026-06-05", l, "", "", h),
    general: (l, h) =>
      getGeneralStatusUserPrompt("{}", "2026-06-05", l, "", "", h),
  };

  for (const [name, build] of Object.entries(BUILDERS)) {
    it(`${name}: EN leads verdict-first and no longer instructs number-first`, () => {
      const p = build("en");
      // The old number-first instruction is gone.
      expect(p).not.toMatch(/name the current .* with a concrete number/i);
      expect(p).not.toMatch(/name the current systolic\/diastolic level/i);
      // Verdict-first: opens on meaning, explicitly NOT the number/value.
      expect(p).toMatch(/open with/i);
      expect(p).toMatch(/not (a|the) (number|value)/i);
      // The number stays required as support (grounding preserved).
      expect(p).toMatch(/as support|snapshot/i);
    });

    it(`${name}: DE leads verdict-first and no longer instructs number-first`, () => {
      const p = build("de");
      expect(p).not.toMatch(/benenne das aktuelle/i);
      expect(p).toMatch(/beginne mit/i);
      expect(p).toMatch(/nicht (der|mit einer) Zahl/i);
      expect(p).toMatch(/als Beleg|Snapshot/i);
    });

    it(`${name}: emits the OPENER HINT line only when a hint is passed`, () => {
      expect(
        build("en", "Open with the overall read in plain words."),
      ).toContain("OPENER HINT: Open with the overall read in plain words.");
      // Backward-compatible: no hint → no dangling OPENER HINT line.
      expect(build("en")).not.toContain("OPENER HINT");
      expect(build("en")).not.toContain("undefined");
    });
  }
});

describe("metric-archetype system prompt — archetype grounding intact", () => {
  it("still injects the archetype section + metadata", () => {
    const meta = getMetricStatusMeta("SLEEP_DURATION")!;
    const sys = getMetricArchetypeSystemPrompt(meta, "en");
    expect(sys).toContain("SLEEP");
    expect(sys).toContain("Sleep duration");
  });
});
