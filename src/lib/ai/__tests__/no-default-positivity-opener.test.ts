import { describe, it, expect } from "vitest";
import {
  getStrictInsightsSystemPrompt,
  PROMPT_VERSION,
} from "../prompts/insight-generator";

/**
 * v1.4.19 — strip the default-positivity opener.
 *
 * The maintainer reported every insight summary started with the same
 * "Datengrundlage ist sehr stark" / "Your data foundation is strong"
 * filler sentence. The user does not see what fields the snapshot
 * carries, so this opener reads as awkward filler.
 *
 * The new ground rule:
 *   - Mention data quality ONLY when it materially limits the
 *     analysis (n<7 in the analyzed window, recencyDays>14, or
 *     coverage gap that biases the comparison).
 *   - When data is fine, dive straight into the analysis.
 *   - Banned opener phrases are listed verbatim in the prompt.
 *
 * These tests pin the rule's presence in BOTH locales so a future
 * prompt rewrite cannot silently drop it.
 */

describe("v1.4.19 no-default-positivity opener rule", () => {
  it("PROMPT_VERSION is at least 4.19.0", () => {
    const [major, minor] = PROMPT_VERSION.split(".").map(Number);
    // 4.19.x or any later major.
    if (major === 4) {
      expect(minor).toBeGreaterThanOrEqual(19);
    } else {
      expect(major).toBeGreaterThan(4);
    }
  });

  it("English prompt forbids opening with a data-quality compliment", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toMatch(/do not open with a compliment about the data/i);
  });

  it("German prompt forbids opening with a data-quality compliment", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/beginne nicht mit einem kompliment/i);
  });

  it("English prompt names the trigger thresholds for the data-quality caveat", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toContain("n<7");
    expect(prompt).toContain("recencyDays>14");
    expect(prompt).toMatch(/coverage gap/i);
  });

  it("German prompt names the trigger thresholds for the data-quality caveat", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toContain("n<7");
    expect(prompt).toContain("recencyDays>14");
    expect(prompt).toMatch(/coverage-lücke/i);
  });

  it("English prompt lists 'Your data foundation is strong' as a banned opener", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    // Allow whitespace incl. newline between phrase tokens so a future
    // re-flow of the prompt doesn't break the assertion.
    expect(prompt).toMatch(/Your data foundation\s+is strong/);
  });

  it("German prompt lists 'Datengrundlage ist sehr stark' as a banned opener", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    // Allow whitespace incl. newline at any token boundary so the
    // assertion survives a future re-flow of the prompt.
    expect(prompt).toMatch(/Datengrundlage\s+ist\s+sehr\s+stark/);
  });

  it("English prompt instructs to dive straight into analysis when data is fine", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toMatch(/dive straight\s+into the analysis/i);
  });

  it("German prompt instructs to dive straight into analysis when data is fine", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/steige\s+sofort in die analyse\s+ein/i);
  });
});
