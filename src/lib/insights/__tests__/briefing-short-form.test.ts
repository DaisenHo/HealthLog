/**
 * #1217 — the briefing's short form on the `frugal` usage level. The contract
 * keeps its shape on every level: `recommendations` stays present (the
 * native client decodes it as a required array), only shorter on `frugal`,
 * and untouched on `standard` and `full`.
 */
import { describe, expect, it } from "vitest";

import { aiInsightResponseSchema } from "@/lib/ai/schema";
import { AI_USAGE_LEVEL_EFFECTS, AI_USAGE_LEVELS } from "@/lib/ai/usage-level";
import {
  SHORT_FORM_LIMITS,
  applyBriefingShortForm,
  buildBriefingShortFormBlock,
} from "@/lib/insights/briefing-short-form";

function rec(id: string) {
  return {
    id,
    text: `Recommendation ${id}`,
    severity: "suggestion",
    metricSource: {
      type: "bloodPressure",
      timeRange: "last30days",
      summary: "avg 128/82",
    },
    rationale: {
      dataWindow: "last30days",
      comparedTo: "your 90-day median",
      deviation: "+4 mmHg",
    },
  };
}

function finding(n: number) {
  return {
    tone: "info",
    headline: `Finding ${n}`,
    detail: "One sentence.",
    delta: null,
    sourceWindow: "30d",
    sourceMetric: "bp",
  };
}

const PAYLOAD = {
  summary: "A steady day.",
  recommendations: [rec("rec-1"), rec("rec-2"), rec("rec-3")],
  citations: [
    { type: "bloodPressure", timeRange: "last30days", summary: "avg 128/82" },
  ],
  warnings: [],
  dailyBriefing: {
    paragraph: "Today reads like a steady day.",
    keyFindings: [finding(1), finding(2), finding(3), finding(4)],
  },
  trendAnnotations: { bp: "Steady over the month." },
  storyboardAnnotations: [],
};

describe("briefing form per usage level", () => {
  it("keeps the full contract on standard and full, the short form on frugal", () => {
    expect(
      AI_USAGE_LEVELS.map((level) => AI_USAGE_LEVEL_EFFECTS[level].briefing),
    ).toEqual(["short", "full", "full"]);
  });

  it("adds nothing to the prompt for the full form", () => {
    expect(buildBriefingShortFormBlock("en", "full")).toBe("");
    expect(buildBriefingShortFormBlock("de", "full")).toBe("");
  });

  it("asks for at most one recommendation on the short form, field kept", () => {
    const en = buildBriefingShortFormBlock("en", "short");
    expect(en).toContain('"recommendations": at most 1');
    expect(en).toContain("every required field");
    expect(buildBriefingShortFormBlock("de", "short")).toContain(
      '"recommendations": höchstens 1',
    );
  });
});

describe("applyBriefingShortForm", () => {
  it("validates against the briefing schema before and after", () => {
    expect(aiInsightResponseSchema.safeParse(PAYLOAD).success).toBe(true);
    const short = applyBriefingShortForm(PAYLOAD);
    const parsed = aiInsightResponseSchema.safeParse(short);
    expect(parsed.success).toBe(true);
  });

  it("keeps recommendations present, at most one", () => {
    const short = applyBriefingShortForm(PAYLOAD);
    expect(Array.isArray(short.recommendations)).toBe(true);
    expect(short.recommendations).toHaveLength(
      SHORT_FORM_LIMITS.recommendations,
    );
    expect(short.recommendations[0]!.id).toBe("rec-1");
    expect(short.dailyBriefing.keyFindings).toHaveLength(
      SHORT_FORM_LIMITS.keyFindings,
    );
    expect(short).not.toHaveProperty("trendAnnotations");
    expect(short).not.toHaveProperty("storyboardAnnotations");
    // Every required field of the contract is still there.
    for (const key of ["summary", "recommendations", "citations", "warnings"]) {
      expect(short).toHaveProperty(key);
    }
  });

  it("keeps an empty recommendation list an empty list", () => {
    const short = applyBriefingShortForm({ ...PAYLOAD, recommendations: [] });
    expect(short.recommendations).toEqual([]);
  });

  it("leaves the input untouched", () => {
    const before = structuredClone(PAYLOAD);
    applyBriefingShortForm(PAYLOAD);
    expect(PAYLOAD).toEqual(before);
  });

  it("passes a non-object through", () => {
    expect(applyBriefingShortForm(null)).toBeNull();
  });
});
