/**
 * v1.22 — opener-archetype rotation + hash helpers.
 *
 * The whole point is variety WITHOUT randomness: the choice must be stable for a
 * key (reproducible, testable) yet differ across keys (anti-sameness). These
 * tests pin both halves plus the name-gate cadence and the seed bounds.
 */
import { describe, expect, it } from "vitest";

import {
  OPENER_ARCHETYPES,
  pickOpenerArchetype,
  openerArchetypeHint,
  shouldUseNameForTurn,
  firstNameFromDisplayName,
  dayRotatedSeed,
  hashSeedKey,
} from "../opener-archetype";

describe("pickOpenerArchetype", () => {
  it("is deterministic for a given key", () => {
    const key = "user-1:bp:2026-06-27";
    expect(pickOpenerArchetype(key)).toBe(pickOpenerArchetype(key));
  });

  it("returns a known archetype", () => {
    for (const k of ["a", "b", "c:d:e", "user-9:sleep:2026-01-01"]) {
      expect(OPENER_ARCHETYPES).toContain(pickOpenerArchetype(k));
    }
  });

  it("is anti-same: consecutive day keys do not all collapse to one archetype", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 14; d++) {
      const key = `user-1:bp:2026-06-${String(d).padStart(2, "0")}`;
      seen.add(pickOpenerArchetype(key));
    }
    // Over two weeks the rotation should surface at least 3 distinct openers.
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });

  it("differs across metrics on the same day (no two-in-a-row sameness)", () => {
    const day = "2026-06-27";
    const metrics = ["bp", "weight", "pulse", "sleep", "mood"];
    const seen = new Set(
      metrics.map((m) => pickOpenerArchetype(`user-1:${m}:${day}`)),
    );
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});

describe("openerArchetypeHint", () => {
  it("returns a non-empty hint in EN and DE", () => {
    expect(
      openerArchetypeHint("user-1:bp:2026-06-27", "en").length,
    ).toBeGreaterThan(10);
    expect(
      openerArchetypeHint("user-1:bp:2026-06-27", "de").length,
    ).toBeGreaterThan(10);
  });

  it("non-en/de locales fall back to the EN hint", () => {
    const key = "user-1:bp:2026-06-27";
    expect(openerArchetypeHint(key, "fr")).toBe(openerArchetypeHint(key, "en"));
  });
});

describe("shouldUseNameForTurn", () => {
  it("is deterministic per key", () => {
    expect(shouldUseNameForTurn("u:3")).toBe(shouldUseNameForTurn("u:3"));
  });

  it("fires on roughly one key in three (sparse, not every turn)", () => {
    let yes = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      if (shouldUseNameForTurn(`user-7:${i}`)) yes += 1;
    }
    const rate = yes / N;
    // ~1/3, with generous slack for hash distribution.
    expect(rate).toBeGreaterThan(0.2);
    expect(rate).toBeLessThan(0.45);
  });
});

describe("firstNameFromDisplayName", () => {
  it("takes the first whitespace token", () => {
    expect(firstNameFromDisplayName("Alex Rivera")).toBe("Alex");
    expect(firstNameFromDisplayName("  Sam  ")).toBe("Sam");
  });
  it("is null for empty / whitespace / null", () => {
    expect(firstNameFromDisplayName(null)).toBeNull();
    expect(firstNameFromDisplayName("")).toBeNull();
    expect(firstNameFromDisplayName("   ")).toBeNull();
  });
});

describe("dayRotatedSeed", () => {
  it("is a non-negative bounded integer, stable per key", () => {
    const s = dayRotatedSeed("user-1:week:2026-06-27");
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThan(2_000_000_000);
    expect(dayRotatedSeed("user-1:week:2026-06-27")).toBe(s);
  });
  it("differs across days", () => {
    expect(dayRotatedSeed("u:week:2026-06-27")).not.toBe(
      dayRotatedSeed("u:week:2026-06-28"),
    );
  });
});

describe("hashSeedKey", () => {
  it("is an unsigned 32-bit integer", () => {
    const h = hashSeedKey("anything");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
  });
});
