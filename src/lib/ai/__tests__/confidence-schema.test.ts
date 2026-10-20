import { describe, it, expect } from "vitest";
import { aiInsightResponseSchema, aiRecommendationSchema } from "../schema";

/**
 * v1.4.16 — `recommendation.confidence` schema field.
 *
 * The wrapper overrides the model's confidence with a deterministic
 * value the model emits, but the schema needs
 * to ACCEPT a model-supplied number so payloads round-trip cleanly.
 * The field is `.optional()` because:
 *   - The wrapper fills it post-validation regardless.
 *   - A locally-cached payload that was generated before B5d landed
 *     parses cleanly without the field.
 *
 * When set, the value is an integer 0..100. Decimals or out-of-range
 * values fail parse so a renegade provider can't put us in a UI state
 * where the meter overflows.
 */

const baseRationale = {
  dataWindow: "last7days" as const,
  comparedTo: "your 90-day median (73 bpm)",
  deviation: "+5 bpm above baseline over 7 of 7 days",
};

const baseRec = {
  id: "rec-1",
  text: "Aim for resting pulse below your usual baseline.",
  severity: "suggestion" as const,
  metricSource: {
    type: "pulse",
    timeRange: "last7days",
    summary: "avg 78 bpm across 9 readings",
  },
  rationale: baseRationale,
};

describe("aiRecommendationSchema — confidence", () => {
  it("accepts a recommendation without confidence (legacy + wrapper-fill path)", () => {
    expect(aiRecommendationSchema.safeParse(baseRec).success).toBe(true);
  });

  it("accepts a recommendation with confidence=0", () => {
    expect(
      aiRecommendationSchema.safeParse({ ...baseRec, confidence: 0 }).success,
    ).toBe(true);
  });

  it("accepts a recommendation with confidence=100", () => {
    expect(
      aiRecommendationSchema.safeParse({ ...baseRec, confidence: 100 }).success,
    ).toBe(true);
  });

  it("accepts mid-range integer confidence", () => {
    expect(
      aiRecommendationSchema.safeParse({ ...baseRec, confidence: 67 }).success,
    ).toBe(true);
  });

  it("rejects negative confidence", () => {
    expect(
      aiRecommendationSchema.safeParse({ ...baseRec, confidence: -1 }).success,
    ).toBe(false);
  });

  it("rejects confidence over 100", () => {
    expect(
      aiRecommendationSchema.safeParse({ ...baseRec, confidence: 101 }).success,
    ).toBe(false);
  });

  it("rejects non-integer confidence", () => {
    expect(
      aiRecommendationSchema.safeParse({ ...baseRec, confidence: 67.5 })
        .success,
    ).toBe(false);
  });

  it("preserves confidence on full payload round-trip", () => {
    const payload = {
      summary: "ok",
      recommendations: [{ ...baseRec, confidence: 67 }],
      citations: [
        {
          type: "pulse",
          timeRange: "last7days",
          summary: "avg 78 bpm across 9 readings",
        },
      ],
      warnings: [],
    };
    const result = aiInsightResponseSchema.parse(payload);
    expect(result.recommendations[0].confidence).toBe(67);
  });
});
