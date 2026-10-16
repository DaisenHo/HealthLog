/**
 * #1217 — the AI usage level: resolution, effects and the estimate.
 *
 * The resolution matrix is exhaustive over every stored choice (three levels
 * and none), every default and every ceiling: 4 x 3 x 3 = 36 cases, each
 * checked against a rule written out independently of the resolver.
 */
import { describe, expect, it } from "vitest";

import {
  AI_USAGE_LEVELS,
  AI_USAGE_LEVEL_EFFECTS,
  buildAiUsageState,
  capUsageLevel,
  estimateTokensPerDay,
  parseSyncRegenGapHours,
  resolveAiUsageLevel,
  statusRegenGapHours,
  usageLevelFromDb,
  usageLevelToDb,
  type AiUsageLevel,
} from "@/lib/ai/usage-level";

const RANK: Record<AiUsageLevel, number> = { frugal: 0, standard: 1, full: 2 };

describe("resolveAiUsageLevel — every choice x default x ceiling", () => {
  const choices: Array<AiUsageLevel | null> = [null, ...AI_USAGE_LEVELS];
  let cases = 0;
  for (const preference of choices) {
    for (const defaultLevel of AI_USAGE_LEVELS) {
      for (const maxLevel of AI_USAGE_LEVELS) {
        cases++;
        it(`choice ${preference ?? "none"}, default ${defaultLevel}, ceiling ${maxLevel}`, () => {
          const got = resolveAiUsageLevel({
            preference,
            defaultLevel,
            maxLevel,
          });
          if (preference === null) {
            // No choice: the default, never above the ceiling.
            const expected =
              RANK[defaultLevel] > RANK[maxLevel] ? maxLevel : defaultLevel;
            expect(got).toEqual({ level: expected, source: "default" });
          } else if (RANK[preference] > RANK[maxLevel]) {
            // A choice above the ceiling is capped, and says so.
            expect(got).toEqual({ level: maxLevel, source: "admin_cap" });
          } else {
            expect(got).toEqual({ level: preference, source: "user" });
          }
          // Whatever the inputs, the result never passes the ceiling.
          expect(RANK[got.level]).toBeLessThanOrEqual(RANK[maxLevel]);
        });
      }
    }
  }
  it("covered every combination", () => {
    expect(cases).toBe(36);
  });
});

describe("what each level does", () => {
  it("regenerates status cards after a sync: a day, the operator's gap, the hour", () => {
    expect(statusRegenGapHours("frugal", "sync", 6)).toBe(24);
    // Never more often than standard: an operator gap above a day wins.
    expect(statusRegenGapHours("frugal", "sync", 48)).toBe(48);
    expect(statusRegenGapHours("standard", "sync", 48)).toBe(48);
    expect(statusRegenGapHours("standard", "sync", 6)).toBe(6);
    expect(statusRegenGapHours("standard", "sync", 12)).toBe(12);
    expect(statusRegenGapHours("full", "sync", 12)).toBe(1);
  });

  it("regenerates after a hand entry: six hours on frugal, the hour otherwise", () => {
    expect(statusRegenGapHours("frugal", "manual", 6)).toBe(6);
    expect(statusRegenGapHours("standard", "manual", 24)).toBe(1);
    expect(statusRegenGapHours("full", "manual", 24)).toBe(1);
  });

  it("caps the status snapshot at 10 000 on frugal and 14 000 above", () => {
    expect(
      AI_USAGE_LEVELS.map((l) => AI_USAGE_LEVEL_EFFECTS[l].statusSnapshotChars),
    ).toEqual([10_000, 14_000, 14_000]);
  });

  it("switches background reasoning and the automatic document read off on frugal only", () => {
    for (const level of AI_USAGE_LEVELS) {
      const effect = AI_USAGE_LEVEL_EFFECTS[level];
      expect(effect.backgroundReasoning, level).toBe(level !== "frugal");
      expect(effect.documentsAutoRead, level).toBe(level !== "frugal");
    }
  });

  it("orders the token factors with the levels, full at one", () => {
    const factors = AI_USAGE_LEVELS.map(
      (l) => AI_USAGE_LEVEL_EFFECTS[l].tokenFactor,
    );
    expect(factors).toEqual([...factors].sort((a, b) => a - b));
    expect(AI_USAGE_LEVEL_EFFECTS.full.tokenFactor).toBe(1);
    // Calibrated by the watch-day simulation: standard ~0.31 of full,
    // frugal ~0.15, the nightly warm included.
    expect(AI_USAGE_LEVEL_EFFECTS.standard.tokenFactor).toBe(0.3);
    expect(AI_USAGE_LEVEL_EFFECTS.frugal.tokenFactor).toBe(0.15);
  });
});

describe("the estimate", () => {
  it("is null without three days of history", () => {
    for (const measuredDays of [0, 1, 2]) {
      expect(
        estimateTokensPerDay({
          measuredTokensPerDay: 100_000,
          measuredDays,
          from: "standard",
          target: "full",
        }),
      ).toBeNull();
    }
    expect(
      estimateTokensPerDay({
        measuredTokensPerDay: null,
        measuredDays: 7,
        from: "standard",
        target: "full",
      }),
    ).toBeNull();
  });

  it("scales the measured use by the factor ratio, whole tokens", () => {
    const at = (target: AiUsageLevel) =>
      estimateTokensPerDay({
        measuredTokensPerDay: 100_000,
        measuredDays: 5,
        from: "standard",
        target,
      });
    expect(at("standard")).toBe(100_000);
    expect(at("full")).toBe(333_333);
    expect(at("frugal")).toBe(50_000);
  });
});

describe("buildAiUsageState", () => {
  it("publishes three options in ceiling order with allowance and estimate", () => {
    const state = buildAiUsageState({
      preference: "full",
      defaultLevel: "standard",
      maxLevel: "standard",
      measuredTokensPerDay: 50_000,
      measuredDays: 7,
    });
    expect(state.level).toBe("standard");
    expect(state.source).toBe("admin_cap");
    expect(state.preference).toBe("full");
    expect(state.options.map((o) => [o.level, o.allowed])).toEqual([
      ["frugal", true],
      ["standard", true],
      ["full", false],
    ]);
    expect(state.options.map((o) => o.estimatedTokensPerDay)).toEqual([
      25_000, 50_000, 166_667,
    ]);
    expect(state.measuredTokensPerDay).toBe(50_000);
    expect(state.measuredDays).toBe(7);
  });

  it("publishes no estimate without history", () => {
    const state = buildAiUsageState({
      preference: null,
      defaultLevel: "standard",
      maxLevel: "full",
      measuredTokensPerDay: null,
      measuredDays: 0,
    });
    expect(state.options.every((o) => o.estimatedTokensPerDay === null)).toBe(
      true,
    );
    expect(state.source).toBe("default");
  });
});

describe("spelling and parsing", () => {
  it("round-trips the database spelling", () => {
    for (const level of AI_USAGE_LEVELS) {
      expect(usageLevelFromDb(usageLevelToDb(level))).toBe(level);
    }
    expect(usageLevelFromDb(null)).toBeNull();
    expect(usageLevelFromDb("LAVISH")).toBeNull();
  });

  it("caps a level at a ceiling", () => {
    expect(capUsageLevel("full", "standard")).toBe("standard");
    expect(capUsageLevel("frugal", "standard")).toBe("frugal");
  });

  it.each([
    ["6", 6],
    [12, 12],
    ["48", 48],
    ["0", null],
    ["49", null],
    ["2.5", null],
    ["", null],
    [undefined, null],
    ["abc", null],
  ])("parses the sync gap %s as %s", (raw, expected) => {
    expect(parseSyncRegenGapHours(raw)).toBe(expected);
  });
});
