import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  aggregateRecommendationFeedback,
  buildCoachFeedbackBuckets,
  buildFeedbackBuckets,
  DEFAULT_FEEDBACK_AGGREGATION_WINDOW_DAYS,
} from "../feedback-aggregator";

interface FeedbackRow {
  recommendationSeverity: string;
  metricSourceType: string;
  providerType: string;
  promptVersion: string;
  helpful: boolean;
  targetType?: string;
}

function makePrismaMock(rows: FeedbackRow[]) {
  return {
    recommendationFeedback: {
      findMany: vi.fn().mockResolvedValue(rows),
    },
    appSettings: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaClient;
}

describe("buildFeedbackBuckets", () => {
  it("groups by (severity, metricSourceType, providerType, promptVersion) and counts up/down", () => {
    const rows: FeedbackRow[] = [
      // Two thumbs-up + one thumbs-down on the same bucket → 2/3 helpfulRate.
      {
        recommendationSeverity: "important",
        metricSourceType: "bloodPressure",
        providerType: "codex",
        promptVersion: "4.16.0",
        helpful: true,
      },
      {
        recommendationSeverity: "important",
        metricSourceType: "bloodPressure",
        providerType: "codex",
        promptVersion: "4.16.0",
        helpful: true,
      },
      {
        recommendationSeverity: "important",
        metricSourceType: "bloodPressure",
        providerType: "codex",
        promptVersion: "4.16.0",
        helpful: false,
      },
      // Different provider in same severity bucket — counted separately.
      {
        recommendationSeverity: "important",
        metricSourceType: "bloodPressure",
        providerType: "openai",
        promptVersion: "4.16.0",
        helpful: false,
      },
    ];
    const buckets = buildFeedbackBuckets(rows);
    expect(buckets).toHaveLength(2);
    const codex = buckets.find((b) => b.providerType === "codex");
    expect(codex).toBeDefined();
    expect(codex?.helpful).toBe(2);
    expect(codex?.notHelpful).toBe(1);
    expect(codex?.total).toBe(3);
    // Math.round(2/3 * 100) / 100 = 0.67
    expect(codex?.helpfulRate).toBeCloseTo(0.67, 2);

    const openai = buckets.find((b) => b.providerType === "openai");
    expect(openai?.helpful).toBe(0);
    expect(openai?.notHelpful).toBe(1);
    expect(openai?.helpfulRate).toBe(0);
  });

  it("sorts buckets deterministically (severity, metricSourceType, provider, prompt)", () => {
    const rows: FeedbackRow[] = [
      {
        recommendationSeverity: "urgent",
        metricSourceType: "weight",
        providerType: "openai",
        promptVersion: "4.16.0",
        helpful: true,
      },
      {
        recommendationSeverity: "info",
        metricSourceType: "mood",
        providerType: "codex",
        promptVersion: "4.16.0",
        helpful: true,
      },
      {
        recommendationSeverity: "info",
        metricSourceType: "bloodPressure",
        providerType: "codex",
        promptVersion: "4.16.0",
        helpful: true,
      },
    ];
    const buckets = buildFeedbackBuckets(rows);
    expect(buckets.map((b) => b.severity)).toEqual(["info", "info", "urgent"]);
    // Within "info" the metricSourceType is the secondary key.
    expect(buckets[0].metricSourceType).toBe("bloodPressure");
    expect(buckets[1].metricSourceType).toBe("mood");
  });

  it("emits an empty array on no rows (aggregator's null-summary path)", () => {
    expect(buildFeedbackBuckets([])).toEqual([]);
  });
});

describe("aggregateRecommendationFeedback", () => {
  it("queries the last 30 days by default and writes a singleton AppSettings row", async () => {
    const now = new Date("2026-05-09T04:00:00Z");
    const prisma = makePrismaMock([
      {
        recommendationSeverity: "suggestion",
        metricSourceType: "weight",
        providerType: "codex",
        promptVersion: "4.16.0",
        helpful: true,
      },
    ]);

    await aggregateRecommendationFeedback(prisma, { now });

    expect(prisma.recommendationFeedback.findMany).toHaveBeenCalledTimes(1);
    const call = (
      prisma.recommendationFeedback.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const expectedSince = new Date(
      now.getTime() - DEFAULT_FEEDBACK_AGGREGATION_WINDOW_DAYS * 86_400_000,
    );
    expect(call.where.createdAt.gte).toEqual(expectedSince);

    expect(prisma.appSettings.upsert).toHaveBeenCalledTimes(1);
    const upsertCall = (prisma.appSettings.upsert as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(upsertCall.where).toEqual({ id: "singleton" });
    const summary = upsertCall.update.adminAiInsightsFeedbackSummary;
    expect(summary.windowDays).toBe(DEFAULT_FEEDBACK_AGGREGATION_WINDOW_DAYS);
    expect(summary.generatedAt).toBe(now.toISOString());
    expect(summary.buckets).toHaveLength(1);
    expect(summary.buckets[0].providerType).toBe("codex");
  });

  it("respects a custom windowDays argument", async () => {
    const now = new Date("2026-05-09T04:00:00Z");
    const prisma = makePrismaMock([]);

    await aggregateRecommendationFeedback(prisma, { now, windowDays: 7 });

    const call = (
      prisma.recommendationFeedback.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0];
    const expectedSince = new Date(now.getTime() - 7 * 86_400_000);
    expect(call.where.createdAt.gte).toEqual(expectedSince);

    const upsertCall = (prisma.appSettings.upsert as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(upsertCall.update.adminAiInsightsFeedbackSummary.windowDays).toBe(7);
    // Empty buckets when no rows.
    expect(upsertCall.update.adminAiInsightsFeedbackSummary.buckets).toEqual(
      [],
    );
    // v1.4.23 — coachBuckets always present, empty by default.
    expect(
      upsertCall.update.adminAiInsightsFeedbackSummary.coachBuckets,
    ).toEqual([]);
  });
});

/**
 * v1.4.23 — Coach-only bucket view. The aggregator slices the
 * unified RecommendationFeedback rows on `targetType === "coach"` and
 * groups by (promptVersion, tone, verbosity).
 */
describe("buildCoachFeedbackBuckets", () => {
  it("ignores non-Coach rows", () => {
    const rows: FeedbackRow[] = [
      {
        recommendationSeverity: "important",
        metricSourceType: "bloodPressure",
        providerType: "codex",
        promptVersion: "4.16.0",
        helpful: true,
        targetType: "recommendation",
      },
    ];
    expect(buildCoachFeedbackBuckets(rows)).toEqual([]);
  });

  it("groups Coach rows by (promptVersion, tone, verbosity)", () => {
    const rows: FeedbackRow[] = [
      {
        recommendationSeverity: "coach",
        metricSourceType: "coach:tone=warm:verbosity=default",
        providerType: "codex",
        promptVersion: "4.23.0",
        helpful: true,
        targetType: "coach",
      },
      {
        recommendationSeverity: "coach",
        metricSourceType: "coach:tone=warm:verbosity=default",
        providerType: "codex",
        promptVersion: "4.23.0",
        helpful: true,
        targetType: "coach",
      },
      {
        recommendationSeverity: "coach",
        metricSourceType: "coach:tone=warm:verbosity=default",
        providerType: "codex",
        promptVersion: "4.23.0",
        helpful: false,
        targetType: "coach",
      },
      {
        recommendationSeverity: "coach",
        metricSourceType: "coach:tone=concise:verbosity=brief",
        providerType: "codex",
        promptVersion: "4.23.0",
        helpful: true,
        targetType: "coach",
      },
    ];
    const buckets = buildCoachFeedbackBuckets(rows);
    expect(buckets).toHaveLength(2);
    const warm = buckets.find(
      (b) => b.tone === "warm" && b.verbosity === "default",
    );
    expect(warm).toBeDefined();
    expect(warm?.helpful).toBe(2);
    expect(warm?.notHelpful).toBe(1);
    expect(warm?.helpfulRate).toBeCloseTo(0.67, 2);
    const concise = buckets.find(
      (b) => b.tone === "concise" && b.verbosity === "brief",
    );
    expect(concise?.total).toBe(1);
    expect(concise?.helpfulRate).toBe(1);
  });

  it("falls back to tone=unknown when metricSourceType doesn't match the encoded shape", () => {
    const rows: FeedbackRow[] = [
      {
        recommendationSeverity: "coach",
        metricSourceType: "weird-shape",
        providerType: "codex",
        promptVersion: "4.23.0",
        helpful: false,
        targetType: "coach",
      },
    ];
    const buckets = buildCoachFeedbackBuckets(rows);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].tone).toBe("unknown");
    expect(buckets[0].verbosity).toBe("unknown");
  });
});
