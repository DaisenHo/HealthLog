/**
 * v1.11.0 — buildCoachMemoryBlock unit tests.
 *
 * Asserts the rolling-profile block assembles from the two persisted
 * sources (period-narrative read + band transitions), carries the right
 * shape, and is fault-isolated per sub-source so a failing source never
 * sinks the Coach turn.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { BaselineProfile } from "@/lib/insights/derived";

const readPeriodNarrative = vi.fn();
const buildPeriodNarrativeContext = vi.fn();

vi.mock("@/lib/insights/narrative/period-narrative-generate", () => ({
  readPeriodNarrative: (...args: unknown[]) => readPeriodNarrative(...args),
}));
vi.mock("@/lib/insights/narrative/period-narrative", () => ({
  buildPeriodNarrativeContext: (...args: unknown[]) =>
    buildPeriodNarrativeContext(...args),
}));

import { buildCoachMemoryBlock } from "../memory-snapshot";

const PROFILE: BaselineProfile = {
  ageYears: 40,
  sex: "MALE",
  heightCm: 180,
};
const NOW = new Date("2026-06-03T08:00:00.000Z");
const USER = "user-1";

function narrativeRow(text: string) {
  return {
    period: "month" as const,
    locale: "de" as const,
    text,
    dateKey: "2026-06-01",
    provenance: null,
    providerType: "codex",
    promptVersion: "1.11.0",
    updatedAt: "2026-06-01T04:30:00.000Z",
  };
}

function readyContext(
  transitions: Array<{ type: string; direction: "above" | "below" | "in" }>,
) {
  return {
    status: "ready" as const,
    period: "month" as const,
    metricDeltas: [],
    bandTransitions: transitions.map((t) => ({
      type: t.type,
      center: 60,
      bandLow: 50,
      bandHigh: 65,
      direction: t.direction,
      movedOut: t.direction !== "in",
      baselineDays: 21,
    })),
    drivers: [],
    coincidentFlags: [],
    pairsTested: 0,
    fdrQ: 0.1,
    provenance: {
      metrics: transitions.map((t) => t.type),
      window: { from: "2026-05-04", to: "2026-06-03" },
      computedAt: NOW.toISOString(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildCoachMemoryBlock", () => {
  it("assembles priorNarrative + trendMemory from both sources", async () => {
    readPeriodNarrative.mockResolvedValue(
      narrativeRow("Dein Ruhepuls ist diesen Monat leicht gestiegen."),
    );
    buildPeriodNarrativeContext.mockResolvedValue(
      readyContext([
        { type: "HEART_RATE", direction: "above" },
        { type: "WEIGHT", direction: "in" },
      ]),
    );

    const block = await buildCoachMemoryBlock(USER, PROFILE, NOW, "de");

    expect(block).not.toBeNull();
    expect(block?.priorNarrative?.headline).toContain("Ruhepuls");
    expect(block?.priorNarrative?.drivers).toEqual([]);
    expect(block?.trendMemory).toEqual({
      HEART_RATE: {
        priorBand: "in",
        currentBand: "above",
        priorPeriod: "month",
      },
      WEIGHT: { priorBand: "in", currentBand: "in", priorPeriod: "month" },
    });
  });

  it("returns null when neither source yields anything", async () => {
    readPeriodNarrative.mockResolvedValue(null);
    buildPeriodNarrativeContext.mockResolvedValue({
      status: "insufficient",
      period: "month",
      reason: "no-history",
    });

    const block = await buildCoachMemoryBlock(USER, PROFILE, NOW, "de");
    expect(block).toBeNull();
  });

  it("isolates a narrative-read failure — trend memory still stands", async () => {
    readPeriodNarrative.mockRejectedValue(new Error("db down"));
    buildPeriodNarrativeContext.mockResolvedValue(
      readyContext([{ type: "HEART_RATE", direction: "below" }]),
    );

    const block = await buildCoachMemoryBlock(USER, PROFILE, NOW, "de");
    expect(block).not.toBeNull();
    expect(block?.priorNarrative).toBeUndefined();
    expect(block?.trendMemory.HEART_RATE).toEqual({
      priorBand: "in",
      currentBand: "below",
      priorPeriod: "month",
    });
  });

  it("isolates a context failure — narrative recall still stands", async () => {
    readPeriodNarrative.mockResolvedValue(narrativeRow("Stabiler Monat."));
    buildPeriodNarrativeContext.mockRejectedValue(new Error("compute failed"));

    const block = await buildCoachMemoryBlock(USER, PROFILE, NOW, "de");
    expect(block).not.toBeNull();
    expect(block?.priorNarrative?.headline).toBe("Stabiler Monat.");
    expect(block?.trendMemory).toEqual({});
  });

  it("caps an over-long narrative headline", async () => {
    const long = "x".repeat(900);
    readPeriodNarrative.mockResolvedValue(narrativeRow(long));
    buildPeriodNarrativeContext.mockResolvedValue(readyContext([]));

    const block = await buildCoachMemoryBlock(USER, PROFILE, NOW, "de");
    expect(block?.priorNarrative?.headline.length).toBeLessThanOrEqual(601);
    expect(block?.priorNarrative?.headline.endsWith("…")).toBe(true);
  });

  it("ignores a blank narrative row", async () => {
    readPeriodNarrative.mockResolvedValue(narrativeRow("   "));
    buildPeriodNarrativeContext.mockResolvedValue(
      readyContext([{ type: "HEART_RATE", direction: "above" }]),
    );

    const block = await buildCoachMemoryBlock(USER, PROFILE, NOW, "de");
    expect(block?.priorNarrative).toBeUndefined();
    expect(block?.trendMemory.HEART_RATE).toBeDefined();
  });

  it("reads the narrative with the requested locale", async () => {
    readPeriodNarrative.mockResolvedValue(null);
    buildPeriodNarrativeContext.mockResolvedValue(readyContext([]));

    await buildCoachMemoryBlock(USER, PROFILE, NOW, "en");
    expect(readPeriodNarrative).toHaveBeenCalledWith(USER, "month", "en");
  });

  // The narrative row is keyed by the full UI locale union. A French account's
  // recall must read the `fr` row — narrowing it to `de` (the old behaviour)
  // recalled a German narrative, and narrowing it to `en` would read a row
  // that account never has.
  it.each(["fr", "es", "it", "pl"] as const)(
    "reads the %s narrative row without narrowing the locale",
    async (locale) => {
      readPeriodNarrative.mockResolvedValue(null);
      buildPeriodNarrativeContext.mockResolvedValue(readyContext([]));

      await buildCoachMemoryBlock(USER, PROFILE, NOW, locale);
      expect(readPeriodNarrative).toHaveBeenCalledWith(USER, "month", locale);
    },
  );
});
