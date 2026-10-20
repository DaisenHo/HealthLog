import { describe, it, expect } from "vitest";
import { getStrictInsightsSystemPrompt } from "../prompts/insight-generator";

/**
 * v1.4.16 — system prompt advertises the new `rationale`
 * field shape and instructs the model to populate it on every rec.
 *
 * The output-format block in the prompt was previously a 4-field
 * schema (id / text / severity / metricSource). With B5c the
 * recommendation shape grows a `rationale` object. The model is told
 * the exact shape AND that it MUST be populated for every rec —
 * legacy "drop the rec if you can't ground it" guidance from B5a
 * stays in place; the new ground rule extends "and you cannot ground
 * a rec without naming the data window, the comparison baseline, and
 * the deviation."
 */

describe("system prompt — rationale block (B5c)", () => {
  it("EN prompt advertises the rationale shape in the output-format block", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    // The shape itself
    expect(prompt).toMatch(/rationale/i);
    expect(prompt).toMatch(/dataWindow/);
    expect(prompt).toMatch(/comparedTo/);
    expect(prompt).toMatch(/deviation/);
    // The enum is named in the prompt so the model doesn't have to
    // guess the value vocabulary
    expect(prompt).toMatch(/last7days/);
    expect(prompt).toMatch(/last30days/);
    expect(prompt).toMatch(/last90days/);
    expect(prompt).toMatch(/allTime/);
  });

  it("DE prompt advertises the rationale shape in the output-format block", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/rationale/i);
    expect(prompt).toMatch(/dataWindow/);
    expect(prompt).toMatch(/comparedTo/);
    expect(prompt).toMatch(/deviation/);
    expect(prompt).toMatch(/last7days/);
    expect(prompt).toMatch(/allTime/);
  });

  it("EN prompt has a GROUND RULE requiring rationale on every rec", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    // The ground rule names the three required fields together so the
    // model can't truncate to one of them
    expect(prompt).toMatch(/MUST carry a rationale/);
  });

  it("DE prompt has a GROUNDREGEL requiring rationale on every rec", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toMatch(/MUSS .* rationale/i);
  });

  it("EN prompt mentions clear/factual language for rationale", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    // factual / actual data trends — guards against vague placeholder
    // rationale text
    expect(prompt).toMatch(/factual/i);
  });

  it("DE prompt mentions clear/factual language for rationale", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    // German "sachlich" or "konkret" — same intent
    expect(prompt).toMatch(/sachlich|konkret/i);
  });
});
