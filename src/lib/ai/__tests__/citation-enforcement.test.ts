import { describe, it, expect } from "vitest";
import {
  aiInsightResponseSchema,
  metricSourceSchema,
  aiRecommendationSchema,
  type AIInsightResponse,
} from "../schema";

/**
 * Citation-from-data hard requirement.
 *
 * The maintainer, verbatim 2026-05-09: "es muss sich halt irgendwie stützen auf
 * medizinische Dinge."  ("It must ground on medical facts / user data.")
 *
 * Operational meaning:
 *
 *   1. Every recommendation MUST carry a `metricSource` with all three
 *      required fields populated (`type`, `timeRange`, `summary`).
 *      Empty / missing → schema parse fails. The model cannot
 *      fabricate a recommendation that points at "nothing".
 *
 * Point 2 of the original contract — every recommendation's
 * `metricSource` must also appear in `citations[]` — was a cross-check
 * run by a wrapper that had no production caller. Both the wrapper and
 * the cross-check are gone; what remains here is the schema-level half,
 * which is a real definition and is exercised below.
 */

const baseMetricSource = {
  type: "bloodPressure",
  timeRange: "last7days",
  summary: "avg 138/86 across 9 readings",
};

const baseCitation = {
  type: "bloodPressure",
  timeRange: "last7days",
  summary: "avg 138/86 across 9 readings",
};

const baseRationale = {
  dataWindow: "last7days" as const,
  comparedTo: "your 90-day median (122/78)",
  deviation: "+16/+8 mmHg above baseline over 9 of 9 readings",
};

const baseValid: AIInsightResponse = {
  summary: "BP runs slightly above your 90-day median.",
  recommendations: [
    {
      id: "rec-1",
      text: "Discuss home BP log with your physician.",
      severity: "important",
      metricSource: baseMetricSource,
      rationale: baseRationale,
    },
  ],
  citations: [baseCitation],
  warnings: [],
};

describe("citation-from-data — schema-level enforcement", () => {
  it("recommendation without metricSource fails parse", () => {
    const broken = {
      ...baseValid,
      recommendations: [
        {
          id: "rec-1",
          text: "Walk more.",
          severity: "suggestion",
          // metricSource missing entirely
        },
      ],
    };
    const result = aiRecommendationSchema.safeParse(broken.recommendations[0]);
    expect(result.success).toBe(false);
  });

  it("recommendation with empty metricSource.summary fails parse", () => {
    const broken = {
      ...baseValid,
      recommendations: [
        {
          id: "rec-1",
          text: "Walk more.",
          severity: "suggestion",
          metricSource: {
            type: "activity",
            timeRange: "last7days",
            summary: "",
          },
        },
      ],
    };
    const result = aiInsightResponseSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it("recommendation with missing metricSource.type fails parse", () => {
    const broken = {
      ...baseValid,
      recommendations: [
        {
          id: "rec-1",
          text: "X",
          severity: "info",
          metricSource: { timeRange: "last7days", summary: "data" },
        },
      ],
    };
    const result = aiInsightResponseSchema.safeParse(broken);
    expect(result.success).toBe(false);
  });

  it("recommendation with missing metricSource.timeRange fails parse", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseValid,
      recommendations: [
        {
          id: "rec-1",
          text: "X",
          severity: "info",
          metricSource: { type: "bloodPressure", summary: "data" },
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("metricSource alone (without recommendation wrapper) — empty summary still fails", () => {
    const result = metricSourceSchema.safeParse({
      type: "x",
      timeRange: "y",
      summary: "",
    });
    expect(result.success).toBe(false);
  });

  it("well-formed citation gets through", () => {
    const result = aiInsightResponseSchema.safeParse(baseValid);
    expect(result.success).toBe(true);
  });
});
