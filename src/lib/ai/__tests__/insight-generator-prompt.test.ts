import { describe, it, expect } from "vitest";
import {
  getStrictInsightsSystemPrompt,
  PROMPT_VERSION,
  OUT_OF_SCOPE_REFUSAL_EN,
  OUT_OF_SCOPE_REFUSAL_DE,
} from "../prompts/insight-generator";
import { aiInsightResponseSchema } from "../schema";

/**
 * Scope-hardened system prompt assertions.
 *
 * These tests verify three pillars:
 *
 *   1. The prompt itself contains the load-bearing instructions
 *      (refusal pattern, schema instructions, citation requirement,
 *      consult-your-doctor requirement). Catches accidental rewrites
 *      that drop a guard.
 *   2. Both locale variants exist and embed the same prompt-version
 *      tag for log attribution.
 *   3. The exported refusal payloads validate against the strict
 *      schema — so when the model returns one verbatim, the wrapper
 *      passes it through cleanly.
 */

describe("scope-hardened system prompt", () => {
  it("English version is non-empty and contains the version tag", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain(PROMPT_VERSION);
    expect(PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("German version is non-empty and contains the version tag", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt.length).toBeGreaterThan(500);
    expect(prompt).toContain(PROMPT_VERSION);
  });

  it("English prompt forbids diagnosis and prescription explicitly", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toMatch(/do not diagnose/i);
    expect(prompt).toMatch(/do not prescribe/i);
  });

  it("German prompt forbids diagnosis and prescription explicitly", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/diagnostizierst NICHT/);
    expect(prompt).toMatch(/verschreibst NICHT/);
  });

  it("English prompt keeps ECG device-verdict-only and forbids interpretation", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    // Attribution + existence allowed; interpretation of the trace forbidden.
    expect(prompt).toMatch(/ECG recordings are DEVICE-VERDICT ONLY/);
    expect(prompt).toMatch(/never read morphology/i);
    expect(prompt).toMatch(/never measure intervals/i);
    expect(prompt).toMatch(/attribute its result to the device/i);
  });

  it("German prompt keeps ECG device-verdict-only and forbids interpretation", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/EKG-Aufzeichnungen sind NUR das GERÄTE-URTEIL/);
    expect(prompt).toMatch(/keine Morphologie/i);
    expect(prompt).toMatch(/dem Gerät zuschreiben/i);
  });

  it("English prompt instructs the doctor-consult call-to-action", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toMatch(/consult your doctor/i);
  });

  it("German prompt instructs the doctor-consult call-to-action", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/konsultiere deinen Arzt/i);
  });

  it("English prompt requires the citation cross-check", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toContain("citations[]");
    expect(prompt).toMatch(/MUST also\s+appear in the top-level/);
  });

  it("German prompt requires the citation cross-check", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toContain("citations[]");
    expect(prompt).toMatch(/MUSS auch\s+im\s+Top-Level/);
  });

  it("English prompt names ESH/ESC 2024 BP guidance generically", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toMatch(/ESH\/ESC/);
    expect(prompt).toMatch(/140\/90/);
  });

  it("German prompt names ESH/ESC 2024 BP guidance generically", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/ESH\/ESC/);
    expect(prompt).toMatch(/140\/90/);
  });

  it("English prompt instructs the out-of-scope refusal pattern", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toMatch(/OUT-OF-SCOPE/);
    expect(prompt).toContain(OUT_OF_SCOPE_REFUSAL_EN.summary);
  });

  it("German prompt instructs the out-of-scope refusal pattern", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/OUT-OF-SCOPE/);
    expect(prompt).toContain(OUT_OF_SCOPE_REFUSAL_DE.summary);
  });

  it("English prompt explicitly forbids inventing measurements", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toMatch(/do not invent measurements/i);
  });

  it("German prompt explicitly forbids inventing measurements", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/erfinde keine messwerte/i);
  });
});

describe("out-of-scope refusal payloads", () => {
  it("English refusal payload validates against the strict schema", () => {
    const result = aiInsightResponseSchema.safeParse(OUT_OF_SCOPE_REFUSAL_EN);
    expect(result.success).toBe(true);
    expect(result.data?.recommendations).toEqual([]);
    expect(result.data?.citations).toEqual([]);
  });

  it("German refusal payload validates against the strict schema", () => {
    const result = aiInsightResponseSchema.safeParse(OUT_OF_SCOPE_REFUSAL_DE);
    expect(result.success).toBe(true);
  });
});
