import { describe, it, expect } from "vitest";
import {
  aiInsightResponseSchema,
  dailyBriefingKeyFindingSchema,
  dailyBriefingSchema,
  type AIInsightResponse,
} from "../schema";
import { PROMPT_VERSION } from "../prompts/insight-generator";

/**
 * v1.4.20 — Daily Briefing schema validation.
 *
 * The Insights redesign hero strip + briefing card render a narrative
 * paragraph + 0-5 key findings. The schema is `nullable().optional()`
 * on the response so legacy v1.4.19 cached payloads round-trip without
 * forcing a regenerate. Fresh generations after PROMPT_VERSION 4.20.0
 * emit the block.
 *
 * Acceptance covered here:
 *   1. Legacy payload (no `dailyBriefing` field at all) parses.
 *   2. Well-formed Daily Briefing parses round-trip.
 *   3. > 5 findings is rejected (hard cap so the model can't pad).
 *   4. Empty paragraph is rejected (briefing card never paints void).
 *   5. Each key finding requires headline + detail (no placeholders).
 *   6. PROMPT_VERSION matches `^4\.20\.\d+$`.
 */

const baseFinding = {
  tone: "good" as const,
  headline: "Blood pressure entered target",
  detail: "9 of last 10 readings under 130/85.",
  delta: "↓ 4 mmHg",
  sourceWindow: "30d" as const,
  sourceMetric: "bp" as const,
};

const baseBriefing = {
  paragraph:
    "You're trending well this week — blood pressure is settling into your target band " +
    "for the first time since February. Three things stand out: medication compliance " +
    "is a 21-day streak, weight is down 2.5 kg over 30 days, and the mood-vs-pulse " +
    "correlation that worried you in March has weakened. One thing to watch: morning " +
    "systolic is still 6 mmHg above target on Mondays.",
  keyFindings: [
    baseFinding,
    {
      tone: "watch" as const,
      headline: "Monday-morning systolic spike",
      detail: "+6 mmHg vs other weekdays. Often follows late Sunday sleep.",
      delta: "+6 mmHg",
      sourceWindow: "30d" as const,
      sourceMetric: "bp" as const,
    },
    {
      tone: "info" as const,
      headline: "Weight down 30 d",
      detail: "Linear, sustainable rate. BMI is now 26.0.",
      delta: "−2.5 kg",
      sourceWindow: "30d" as const,
      sourceMetric: "weight" as const,
    },
  ],
};

const baseResponse: AIInsightResponse = {
  summary: "Things are trending well this week.",
  recommendations: [],
  citations: [],
  warnings: [],
};

describe("PROMPT_VERSION", () => {
  it("stays on the 4.x / 5.x train", () => {
    // v1.22 (W6) bumped to 5.0.0 for the verdict-first briefing rewrite.
    expect(PROMPT_VERSION).toMatch(/^[45]\.\d+\.\d+$/);
  });
});

describe("dailyBriefingKeyFindingSchema", () => {
  it("accepts a well-formed finding", () => {
    expect(dailyBriefingKeyFindingSchema.safeParse(baseFinding).success).toBe(
      true,
    );
  });

  it.each(["good", "watch", "info"] as const)("accepts tone=%s", (tone) => {
    const result = dailyBriefingKeyFindingSchema.safeParse({
      ...baseFinding,
      tone,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown tone", () => {
    const result = dailyBriefingKeyFindingSchema.safeParse({
      ...baseFinding,
      tone: "danger",
    });
    expect(result.success).toBe(false);
  });

  it.each(["7d", "30d", "90d", "1y"] as const)(
    "accepts sourceWindow=%s",
    (sourceWindow) => {
      const result = dailyBriefingKeyFindingSchema.safeParse({
        ...baseFinding,
        sourceWindow,
      });
      expect(result.success).toBe(true);
    },
  );

  it("defaults sourceWindow to 30d when omitted", () => {
    const { sourceWindow: _omit, ...withoutWindow } = baseFinding;
    void _omit;
    const result = dailyBriefingKeyFindingSchema.safeParse(withoutWindow);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sourceWindow).toBe("30d");
    }
  });

  it.each([
    "bp",
    "weight",
    "pulse",
    "mood",
    "compliance",
    // ── v1.4.23 Apple Health additive ──
    "hrv",
    "sleep",
    "resting_hr",
    "steps",
    "active_energy",
    "flights",
    "distance",
    "vo2_max",
    "body_temp",
  ] as const)("accepts sourceMetric=%s", (sourceMetric) => {
    const result = dailyBriefingKeyFindingSchema.safeParse({
      ...baseFinding,
      sourceMetric,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unknown sourceMetric", () => {
    // `bodyComposition` is intentionally NOT a token in the enum; the
    // v1.4.23 extension keeps the unknown-rejection path exercised
    // without leaking a brand-new sentinel value into the prompt body.
    const result = dailyBriefingKeyFindingSchema.safeParse({
      ...baseFinding,
      sourceMetric: "bodyComposition",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a null delta", () => {
    const result = dailyBriefingKeyFindingSchema.safeParse({
      ...baseFinding,
      delta: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty headline", () => {
    const result = dailyBriefingKeyFindingSchema.safeParse({
      ...baseFinding,
      headline: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty detail", () => {
    const result = dailyBriefingKeyFindingSchema.safeParse({
      ...baseFinding,
      detail: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("dailyBriefingSchema", () => {
  it("accepts a well-formed briefing", () => {
    expect(dailyBriefingSchema.safeParse(baseBriefing).success).toBe(true);
  });

  it("rejects empty paragraph", () => {
    const result = dailyBriefingSchema.safeParse({
      ...baseBriefing,
      paragraph: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts an empty keyFindings array", () => {
    const result = dailyBriefingSchema.safeParse({
      ...baseBriefing,
      keyFindings: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects > 5 keyFindings (hard cap)", () => {
    const result = dailyBriefingSchema.safeParse({
      ...baseBriefing,
      keyFindings: [
        baseFinding,
        baseFinding,
        baseFinding,
        baseFinding,
        baseFinding,
        baseFinding,
      ],
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 5 keyFindings (boundary)", () => {
    const result = dailyBriefingSchema.safeParse({
      ...baseBriefing,
      keyFindings: [
        baseFinding,
        baseFinding,
        baseFinding,
        baseFinding,
        baseFinding,
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("aiInsightResponseSchema — dailyBriefing integration", () => {
  it("legacy payload (no dailyBriefing field) still parses", () => {
    expect(aiInsightResponseSchema.safeParse(baseResponse).success).toBe(true);
  });

  it("payload with dailyBriefing=null still parses", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      dailyBriefing: null,
    });
    expect(result.success).toBe(true);
  });

  it("payload with a well-formed dailyBriefing parses round-trip", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      dailyBriefing: baseBriefing,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dailyBriefing?.paragraph).toBe(baseBriefing.paragraph);
      expect(result.data.dailyBriefing?.keyFindings).toHaveLength(3);
    }
  });

  it("payload with > 5 keyFindings is rejected at the response level too", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      dailyBriefing: {
        ...baseBriefing,
        keyFindings: Array(6).fill(baseFinding),
      },
    });
    expect(result.success).toBe(false);
  });

  it("payload with empty paragraph is rejected at the response level too", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      dailyBriefing: {
        paragraph: "",
        keyFindings: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("payload with a finding missing required fields is rejected", () => {
    const result = aiInsightResponseSchema.safeParse({
      ...baseResponse,
      dailyBriefing: {
        paragraph: baseBriefing.paragraph,
        keyFindings: [{ tone: "good", headline: "", detail: "x" }],
      },
    });
    expect(result.success).toBe(false);
  });
});
