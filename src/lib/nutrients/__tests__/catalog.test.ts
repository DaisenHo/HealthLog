/**
 * v1.28 — nutrient-catalog invariants.
 *
 * The catalog is the closed source of truth for the intake sync: codes,
 * HK identifiers, canonical units (the µg/mg guard), plausibility caps,
 * and the EFSA references a later Coach block reads. These tests pin
 * the invariants the routes and the wire contract rely on.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  NUTRIENT_CATALOG,
  NUTRIENT_CODES,
  NUTRIENT_DEFINITIONS,
  SYNCABLE_NUTRIENT_CODES,
  isAboveUpperLimit,
  isNutrientCode,
  isSyncableNutrientCode,
  resolveNutrientReference,
  toCanonicalNutrientAmount,
} from "../catalog";

/** The codes HealthKit sends, which carry an HK identifier and a reference. */
const SYNCABLE = NUTRIENT_DEFINITIONS.filter((d) => d.syncable);

describe("nutrient catalog", () => {
  it("carries exactly the 26 syncable codes plus the two supplement-only ones (no sodium, no potassium, no macros)", () => {
    expect(SYNCABLE_NUTRIENT_CODES).toHaveLength(26);
    expect(NUTRIENT_CODES).toHaveLength(28);
    expect(NUTRIENT_CODES.filter((c) => !isSyncableNutrientCode(c))).toEqual([
      "dha",
      "epa",
    ]);
    expect(Object.keys(NUTRIENT_CATALOG).sort()).toEqual(
      [...NUTRIENT_CODES].sort(),
    );
    // The maintainer exclusions stay excluded.
    for (const banned of [
      "sodium",
      "potassium",
      "energy",
      "carbohydrates",
      "protein",
      "fat",
      "sugar",
      "fiber",
    ]) {
      expect(isNutrientCode(banned), `banned code present: ${banned}`).toBe(
        false,
      );
    }
  });

  it("codes and HealthKit identifiers are unique, and every HK id is a Dietary quantity type", () => {
    const codes = new Set<string>();
    const hkIds = new Set<string>();
    for (const def of SYNCABLE) {
      expect(def.hkIdentifier).not.toBeNull();
      const hk = def.hkIdentifier!;
      expect(codes.has(def.code)).toBe(false);
      expect(hkIds.has(hk)).toBe(false);
      codes.add(def.code);
      hkIds.add(hk);
      expect(hk).toMatch(/^HKQuantityTypeIdentifierDietary[A-Za-z0-9]+$/);
    }
  });

  it("every unit is canonical (mg | ug | ml) and water is the only ml type", () => {
    for (const def of NUTRIENT_DEFINITIONS) {
      expect(["mg", "ug", "ml"]).toContain(def.unit);
    }
    const mlCodes = NUTRIENT_DEFINITIONS.filter((d) => d.unit === "ml").map(
      (d) => d.code,
    );
    expect(mlCodes).toEqual(["water"]);
    // The known-µg micros stay µg — a silent switch to mg here would be
    // the exact 1000× hazard the unit echo guards against.
    for (const ugCode of [
      "vitamin_a",
      "biotin",
      "folate",
      "vitamin_b12",
      "vitamin_d",
      "vitamin_k",
      "selenium",
      "chromium",
      "molybdenum",
      "iodine",
    ] as const) {
      expect(NUTRIENT_CATALOG[ugCode].unit).toBe("ug");
    }
    expect(NUTRIENT_CATALOG.caffeine.unit).toBe("mg");
  });

  it("every code carries a finite positive plausibility cap", () => {
    for (const def of NUTRIENT_DEFINITIONS) {
      expect(Number.isFinite(def.plausibleDailyMax)).toBe(true);
      expect(def.plausibleDailyMax).toBeGreaterThan(0);
    }
    // The design-pinned guards.
    expect(NUTRIENT_CATALOG.caffeine.plausibleDailyMax).toBe(2000);
    expect(NUTRIENT_CATALOG.water.plausibleDailyMax).toBe(20000);
  });

  it("the supplement-only codes carry no HealthKit identifier and no reference of their own", () => {
    for (const code of ["dha", "epa"] as const) {
      const def = NUTRIENT_CATALOG[code];
      expect(def.hkIdentifier).toBeNull();
      expect(def.syncable).toBe(false);
      expect(def.unit).toBe("mg");
      expect(def.reference).toBeNull();
    }
  });

  it("every syncable code has a reference entry carrying kind, direction, a citation, and a resolvable value", () => {
    for (const def of SYNCABLE) {
      const ref = def.reference!;
      expect(ref, `missing reference: ${def.code}`).toBeTruthy();
      expect(["PRI", "AI", "safeLevel"]).toContain(ref.kind);
      expect(["target", "upperGuidance"]).toContain(ref.direction);
      expect(ref.source.length).toBeGreaterThan(0);
      // Value shape: a uniform adult value XOR a full sex split — never
      // both, never a half split (profile resolution depends on this).
      const hasAdult = ref.adult != null;
      const hasMale = ref.male != null;
      const hasFemale = ref.female != null;
      expect(hasMale, `half sex-split: ${def.code}`).toBe(hasFemale);
      expect(hasAdult !== hasMale, `value shape: ${def.code}`).toBe(true);
      for (const v of [ref.adult, ref.male, ref.female]) {
        if (v != null) expect(v).toBeGreaterThan(0);
      }
    }
  });

  it("caffeine is the one upperGuidance reference; everything else is a target", () => {
    for (const def of SYNCABLE) {
      expect(def.reference!.direction).toBe(
        def.code === "caffeine" ? "upperGuidance" : "target",
      );
    }
    expect(NUTRIENT_CATALOG.caffeine.reference!.kind).toBe("safeLevel");
    expect(NUTRIENT_CATALOG.caffeine.reference!.adult).toBe(400);
  });

  it("every citation names EFSA, except the documented chromium exception (EFSA sets no DRV)", () => {
    for (const def of SYNCABLE) {
      if (def.code === "chromium") {
        expect(def.reference!.source).toContain("NIH");
        expect(def.reference!.source).toContain("EFSA");
        continue;
      }
      expect(def.reference!.source, `citation: ${def.code}`).toContain("EFSA");
    }
  });

  it("iron carries the EFSA sex split (11 male / 16 female)", () => {
    expect(NUTRIENT_CATALOG.iron.reference!.male).toBe(11);
    expect(NUTRIENT_CATALOG.iron.reference!.female).toBe(16);
  });

  it("every labelKey follows nutrients.names.<code> and resolves in the EN bundle", () => {
    const en = JSON.parse(
      readFileSync(join(__dirname, "../../../../messages/en.json"), "utf8"),
    ) as { nutrients?: { names?: Record<string, string> } };
    for (const def of NUTRIENT_DEFINITIONS) {
      expect(def.labelKey).toBe(`nutrients.names.${def.code}`);
      expect(
        en.nutrients?.names?.[def.code],
        `EN name missing: ${def.code}`,
      ).toBeTruthy();
    }
  });
});

describe("resolveNutrientReference (v1.29)", () => {
  it("resolves a uniform-adult reference (calcium) regardless of sex, including unknown", () => {
    for (const sex of ["MALE", "FEMALE", null] as const) {
      const ref = resolveNutrientReference("calcium", sex);
      expect(ref).not.toBeNull();
      expect(ref?.value).toBe(950);
      expect(ref?.kind).toBe("PRI");
      expect(ref?.direction).toBe("target");
      expect(ref?.source).toBe(NUTRIENT_CATALOG.calcium.reference!.source);
    }
  });

  it("resolves a sex-split reference (water, iron) to the matching value per sex", () => {
    expect(resolveNutrientReference("water", "MALE")?.value).toBe(2500);
    expect(resolveNutrientReference("water", "FEMALE")?.value).toBe(2000);
    expect(resolveNutrientReference("iron", "MALE")?.value).toBe(11);
    expect(resolveNutrientReference("iron", "FEMALE")?.value).toBe(16);
  });

  it("omits a sex-split reference when sex is unknown — never guesses", () => {
    expect(resolveNutrientReference("water", null)).toBeNull();
    expect(resolveNutrientReference("iron", null)).toBeNull();
    expect(resolveNutrientReference("magnesium", null)).toBeNull();
    expect(resolveNutrientReference("vitamin_a", null)).toBeNull();
  });

  it("resolves caffeine's upperGuidance ceiling regardless of sex", () => {
    const ref = resolveNutrientReference("caffeine", null);
    expect(ref).toEqual({
      kind: "safeLevel",
      direction: "upperGuidance",
      value: 400,
      source: NUTRIENT_CATALOG.caffeine.reference!.source,
    });
  });

  it("resolves no reference for a supplement-only code", () => {
    expect(resolveNutrientReference("dha", "MALE")).toBeNull();
    expect(resolveNutrientReference("epa", "FEMALE")).toBeNull();
  });

  it("resolves every syncable code to a non-null reference for at least one sex", () => {
    for (const code of SYNCABLE_NUTRIENT_CODES) {
      const resolved =
        resolveNutrientReference(code, "MALE") ??
        resolveNutrientReference(code, "FEMALE");
      expect(resolved, `no resolvable reference: ${code}`).not.toBeNull();
    }
  });
});

describe("input units and the converter (v1.43)", () => {
  it("lists the canonical unit first with factor 1 on every code", () => {
    for (const def of NUTRIENT_DEFINITIONS) {
      expect(def.inputUnits[0]).toEqual({
        unit: def.unit,
        factorToCanonical: 1,
      });
      const units = def.inputUnits.map((u) => u.unit);
      expect(new Set(units).size).toBe(units.length);
      for (const u of def.inputUnits) {
        expect(u.factorToCanonical).toBeGreaterThan(0);
      }
    }
  });

  it("converts vitamin D from IU at 0.025 µg per IU", () => {
    expect(toCanonicalNutrientAmount("vitamin_d", 1000, "IU")).toBe(25);
    expect(toCanonicalNutrientAmount("vitamin_d", 25, "ug")).toBe(25);
    expect(toCanonicalNutrientAmount("vitamin_d", 0.025, "mg")).toBe(25);
  });

  it("converts across the metric ladder", () => {
    expect(toCanonicalNutrientAmount("magnesium", 0.4, "g")).toBe(400);
    expect(toCanonicalNutrientAmount("magnesium", 500, "ug")).toBe(0.5);
    expect(toCanonicalNutrientAmount("dha", 0.5, "g")).toBe(500);
    expect(toCanonicalNutrientAmount("water", 1.5, "l")).toBe(1500);
  });

  it("refuses a unit the code does not list rather than guessing", () => {
    // Vitamin E has no IU: its factor depends on the natural or synthetic form.
    expect(toCanonicalNutrientAmount("vitamin_e", 400, "IU")).toBeNull();
    expect(toCanonicalNutrientAmount("magnesium", 10, "ml")).toBeNull();
    expect(toCanonicalNutrientAmount("water", 10, "mg")).toBeNull();
  });
});

describe("upper intake levels (v1.43)", () => {
  it("carries a cited EFSA upper limit in the code's canonical unit where one exists", () => {
    for (const def of NUTRIENT_DEFINITIONS) {
      if (!def.upperLimit) continue;
      expect(def.upperLimit.unit, def.code).toBe(def.unit);
      expect(def.upperLimit.value).toBeGreaterThan(0);
      expect(def.upperLimit.source).toContain("EFSA");
    }
    expect(NUTRIENT_CATALOG.vitamin_d.upperLimit?.value).toBe(100);
    expect(NUTRIENT_CATALOG.magnesium.upperLimit?.scope).toBe("supplemental");
    expect(NUTRIENT_CATALOG.vitamin_c.upperLimit).toBeNull();
    expect(NUTRIENT_CATALOG.dha.upperLimit).toBeNull();
  });

  it("compares a total-scope limit against the day's total", () => {
    expect(
      isAboveUpperLimit("vitamin_d", { total: 120, supplemental: 50 }),
    ).toBe(true);
    expect(
      isAboveUpperLimit("vitamin_d", { total: 100, supplemental: 100 }),
    ).toBe(false);
  });

  it("compares a supplemental-scope limit against the supplement share only", () => {
    expect(
      isAboveUpperLimit("magnesium", { total: 600, supplemental: 200 }),
    ).toBe(false);
    expect(
      isAboveUpperLimit("magnesium", { total: 300, supplemental: 300 }),
    ).toBe(true);
  });

  it("answers null, not false, where no limit exists", () => {
    expect(
      isAboveUpperLimit("vitamin_c", { total: 5000, supplemental: 5000 }),
    ).toBeNull();
  });
});

describe("the batch contract stays the syncable codes (v1.43)", () => {
  it("refuses dha and epa in the HealthKit batch and accepts a syncable code", async () => {
    const { nutrientBatchSchema } = await import("@/lib/validations/nutrients");
    const entry = (nutrient: string) => ({
      entries: [{ day: "2026-07-10", nutrient, unit: "mg", amount: 100 }],
    });
    expect(nutrientBatchSchema.safeParse(entry("dha")).success).toBe(false);
    expect(nutrientBatchSchema.safeParse(entry("epa")).success).toBe(false);
    expect(nutrientBatchSchema.safeParse(entry("magnesium")).success).toBe(
      true,
    );
  });
});
