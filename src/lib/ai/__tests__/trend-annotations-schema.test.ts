import { describe, it, expect } from "vitest";
import {
  aiInsightResponseSchema,
  trendAnnotationsSchema,
  type AIInsightResponse,
} from "../schema";
import {
  PROMPT_VERSION,
  getStrictInsightsSystemPrompt,
} from "../prompts/insight-generator";

/**
 * v1.4.20 — Trend Annotations schema + prompt validation.
 *
 * Acceptance covered here:
 *   1. PROMPT_VERSION matches `^4\.20\.\d+$` and is `4.20.1` (B3 bump).
 *   2. trendAnnotationsSchema accepts any combination of bp/weight/mood
 *      strings, each capped at 200 chars; empty strings rejected.
 *   3. aiInsightResponseSchema treats trendAnnotations as nullable +
 *      optional so legacy 4.20.0 caches round-trip.
 *   4. EN + DE prompts both contain GROUND RULE 9 (trendAnnotations)
 *      with the conservative-phrasing + ≤200 char constraint.
 */

const baseResponse: AIInsightResponse = {
  summary: "Things are trending well this week.",
  recommendations: [],
  citations: [],
  warnings: [],
};

describe("PROMPT_VERSION (B3 bump)", () => {
  it("stays on the 4.x / 5.x train", () => {
    // v1.22 (W6) bumped to 5.0.0 for the verdict-first briefing rewrite.
    expect(PROMPT_VERSION).toMatch(/^[45]\.\d+\.\d+$/);
  });

  it("is bumped past 4.20.0 to signal the trendAnnotations format change", () => {
    expect(PROMPT_VERSION).not.toBe("4.20.0");
  });
});

describe("trendAnnotationsSchema", () => {
  it("accepts an empty object — every field is independently optional", () => {
    expect(trendAnnotationsSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a single metric annotation", () => {
    expect(
      trendAnnotationsSchema.safeParse({ bp: "Systolic trending down." })
        .success,
    ).toBe(true);
  });

  it("accepts all three metric annotations", () => {
    const input = {
      bp: "Systolic settling into target — a pattern worth watching.",
      weight: "Weight down 1.4 kg over 30 days, linear rate.",
      mood: "Mood stable, scoring 4 of 5 on most days this month.",
    };
    expect(trendAnnotationsSchema.safeParse(input).success).toBe(true);
  });

  it("rejects an annotation > 200 chars", () => {
    const tooLong = "x".repeat(201);
    expect(trendAnnotationsSchema.safeParse({ bp: tooLong }).success).toBe(
      false,
    );
  });

  it("accepts an annotation at the 200-char boundary", () => {
    const boundary = "x".repeat(200);
    expect(trendAnnotationsSchema.safeParse({ bp: boundary }).success).toBe(
      true,
    );
  });

  it("rejects an empty string for any metric", () => {
    expect(trendAnnotationsSchema.safeParse({ bp: "" }).success).toBe(false);
    expect(trendAnnotationsSchema.safeParse({ weight: "" }).success).toBe(
      false,
    );
    expect(trendAnnotationsSchema.safeParse({ mood: "" }).success).toBe(false);
  });
});

describe("aiInsightResponseSchema — trendAnnotations integration", () => {
  it("legacy payload (no trendAnnotations field) still parses", () => {
    expect(aiInsightResponseSchema.safeParse(baseResponse).success).toBe(true);
  });

  it("payload with trendAnnotations=null still parses", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      trendAnnotations: null,
    });
    expect(result.success).toBe(true);
  });

  it("payload with a partial trendAnnotations parses round-trip", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      trendAnnotations: { bp: "Systolic trending down." },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.trendAnnotations?.bp).toContain("trending down");
    }
  });

  it("payload with a > 200 char annotation is rejected", () => {
    const tooLong = "x".repeat(201);
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      trendAnnotations: { weight: tooLong },
    });
    expect(result.success).toBe(false);
  });
});

describe("system prompt — GROUND RULE 9 (trendAnnotations)", () => {
  it("English prompt declares the trendAnnotations rule", () => {
    const prompt = getStrictInsightsSystemPrompt("en");
    expect(prompt).toContain("trendAnnotations");
    expect(prompt).toMatch(/200 characters/);
    expect(prompt).toMatch(/observational/i);
    expect(prompt).toMatch(/causal/i);
  });

  it("German prompt declares the trendAnnotations rule", () => {
    const prompt = getStrictInsightsSystemPrompt("de");
    expect(prompt).toContain("trendAnnotations");
    expect(prompt).toMatch(/200 Zeichen/);
    expect(prompt).toMatch(/beobachtend/i);
    expect(prompt).toMatch(/kausal/i);
  });

  it("both prompts spell the JSON shape with bp / weight / mood keys", () => {
    for (const locale of ["en", "de"] as const) {
      const prompt = getStrictInsightsSystemPrompt(locale);
      expect(prompt).toMatch(/"bp":/);
      expect(prompt).toMatch(/"weight":/);
      expect(prompt).toMatch(/"mood":/);
    }
  });
});
