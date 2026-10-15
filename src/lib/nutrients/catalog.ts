/**
 * Nutrient catalog — the closed code set for the micronutrient-intake
 * sync (v1.28).
 *
 * 26 syncable codes: the 24 HealthKit `Dietary*` vitamin/mineral quantity
 * types plus DietaryWater and DietaryCaffeine. v1.43 adds two codes no
 * HealthKit type carries (`dha`, `epa`), which only a supplement's
 * composition produces; they appear in responses and never in the batch. Energy, carbohydrates,
 * protein, fat, sugar, fiber AND sodium/potassium are deliberately NOT
 * here — the anti-goal against diet-app territory stands, and
 * sodium/potassium are food-composition signals, not "substances
 * taken" (maintainer decision, out until explicit user demand).
 *
 * This catalog is the single source of truth for:
 *   - the closed `nutrient` code enum on the wire and in storage;
 *   - the canonical storage unit per code, which is ALSO the pinned
 *     HealthKit query unit for iOS (mass types in mg or µg as listed,
 *     water in mL — never IU). The batch route rejects any entry whose
 *     echoed `unit` differs, because a silent µg/mg confusion is a
 *     1000× corruption and the one-string echo is the cheapest guard;
 *   - the generous per-day plausibility cap (ingest guard against
 *     unit-confused or corrupted writers, NOT a health judgement —
 *     values above high-dose supplement reality get skipped);
 *   - the EFSA dietary reference values a later Coach block compares
 *     against. Every reference names its EFSA value kind (PRI /
 *     AI / safeLevel) and a direction: `target` for reference intakes,
 *     `upperGuidance` for caffeine's safe-level ceiling. Sex-split
 *     values resolve against the user profile at consumption time —
 *     a profile without sex omits the reference, never guesses.
 *
 * Reference values are the EFSA DRV Finder adult values (Dietary
 * Reference Values for the EU population); each entry cites its source
 * verbatim in `reference.source`. Where EFSA expresses a vitamin per
 * energy unit (thiamin, niacin), the entry carries the value at the
 * 10 MJ/day reference energy intake and says so in the citation.
 * Chromium is the one exception: EFSA concluded no DRV can be set, so
 * the entry cites the NIH ODS adequate intake instead — spelled out in
 * its source string.
 */

import type { BinaryReferenceSex } from "@/lib/profile/sex";

/**
 * The codes HealthKit may send in the nutrient batch. `NUTRIENT_CODES` adds
 * the supplement-only codes below them; the batch validates against this
 * tuple, so its contract stays the 26 codes it always was.
 */
export const SYNCABLE_NUTRIENT_CODES = [
  // 13 vitamins
  "vitamin_a",
  "thiamin",
  "riboflavin",
  "niacin",
  "pantothenic_acid",
  "vitamin_b6",
  "biotin",
  "folate",
  "vitamin_b12",
  "vitamin_c",
  "vitamin_d",
  "vitamin_e",
  "vitamin_k",
  // 11 minerals (sodium + potassium excluded by directive)
  "calcium",
  "iron",
  "magnesium",
  "phosphorus",
  "zinc",
  "copper",
  "manganese",
  "selenium",
  "chromium",
  "molybdenum",
  "iodine",
  // taken substances with correlation value
  "water",
  "caffeine",
] as const;

/**
 * v1.43 — codes that come only from a supplement's composition. No HealthKit
 * quantity type carries them, so the batch never accepts them and they appear
 * in responses only.
 */
export const SUPPLEMENT_ONLY_NUTRIENT_CODES = ["dha", "epa"] as const;

export const NUTRIENT_CODES = [
  ...SYNCABLE_NUTRIENT_CODES,
  ...SUPPLEMENT_ONLY_NUTRIENT_CODES,
] as const;

export type NutrientCode = (typeof NUTRIENT_CODES)[number];
export type SyncableNutrientCode = (typeof SYNCABLE_NUTRIENT_CODES)[number];

/** Canonical storage units. `ug` is µg on the wire — ASCII on purpose. */
export type NutrientUnit = "mg" | "ug" | "ml";

/**
 * v1.43 — every unit an amount may be ENTERED in. The canonical units plus
 * gram, litre and the international unit. IU exists only where one IU maps to
 * one fixed mass (vitamin D, preformed vitamin A); vitamin E has none, because
 * its IU depends on whether the form is natural or synthetic.
 */
export type NutrientInputUnitCode = NutrientUnit | "g" | "l" | "IU";

/** The unit vocabulary, spelled once. Every other file reads it from here. */
export const NUTRIENT_UNIT = {
  mg: "mg",
  ug: "ug",
  ml: "ml",
  g: "g",
  l: "l",
  IU: "IU",
} as const satisfies Record<NutrientInputUnitCode, NutrientInputUnitCode>;

export interface NutrientInputUnit {
  unit: NutrientInputUnitCode;
  /** Multiply an entered amount by this to get the canonical amount. */
  factorToCanonical: number;
}

/**
 * v1.43 — a tolerable upper intake level (UL): the highest daily intake not
 * expected to cause harm. `scope: "total"` applies to everything taken in a
 * day; `scope: "supplemental"` applies to the part from supplements only
 * (magnesium salts, folic acid), which the server reads as the SUPPLEMENT
 * source. `null` on a code where no UL is established.
 */
export interface NutrientUpperLimit {
  value: number;
  unit: NutrientUnit;
  scope: "total" | "supplemental";
  source: string;
}

export interface NutrientReference {
  /** EFSA value type, named in Coach prose later (Slice B). */
  kind: "PRI" | "AI" | "safeLevel";
  /** `target` = reference intake; `upperGuidance` = do-not-exceed. */
  direction: "target" | "upperGuidance";
  /** Uniform adult value where the source is uniform. */
  adult?: number;
  /** Sex-split values where the source splits (e.g. iron 11 / 16). */
  male?: number;
  female?: number;
  /** Citation, quoted verbatim wherever the reference surfaces. */
  source: string;
}

export interface NutrientDefinition {
  code: NutrientCode;
  /**
   * HealthKit quantity type identifier iOS reads this code from. `null` for a
   * supplement-only code (`dha`, `epa`).
   */
  hkIdentifier: string | null;
  /** Whether HealthKit may send this code in the nutrient batch. */
  syncable: boolean;
  /** Canonical storage unit AND the pinned HK query unit. */
  unit: NutrientUnit;
  /** i18n key for the display name (settings card + exports). */
  labelKey: string;
  /**
   * Generous per-day ingest cap in the canonical unit. Entries above it
   * are skipped `value_out_of_range` — sized well above high-dose
   * supplement reality so only unit confusion / corruption trips it.
   */
  plausibleDailyMax: number;
  /** The reference intake, or `null` where none is set per code. */
  reference: NutrientReference | null;
  /** v1.43 — the units an amount may be entered in, canonical first. */
  inputUnits: ReadonlyArray<NutrientInputUnit>;
  /** v1.43 — the tolerable upper intake level, or `null`. */
  upperLimit: NutrientUpperLimit | null;
}

/**
 * The input units each canonical unit offers by default: the unit itself and
 * its neighbours in the metric ladder. A code adds IU on top where one exists.
 */
const METRIC_INPUT_UNITS: Readonly<
  Record<NutrientUnit, ReadonlyArray<NutrientInputUnit>>
> = {
  mg: [
    { unit: NUTRIENT_UNIT.mg, factorToCanonical: 1 },
    { unit: NUTRIENT_UNIT.ug, factorToCanonical: 0.001 },
    { unit: NUTRIENT_UNIT.g, factorToCanonical: 1000 },
  ],
  ug: [
    { unit: NUTRIENT_UNIT.ug, factorToCanonical: 1 },
    { unit: NUTRIENT_UNIT.mg, factorToCanonical: 1000 },
  ],
  ml: [
    { unit: NUTRIENT_UNIT.ml, factorToCanonical: 1 },
    { unit: NUTRIENT_UNIT.l, factorToCanonical: 1000 },
  ],
};

/**
 * The international unit where one IU is one fixed mass of the canonical unit.
 * Vitamin D: 1 IU = 0.025 µg cholecalciferol. Vitamin A: 1 IU = 0.3 µg
 * retinol (preformed vitamin A, the form supplements state in IU).
 */
const IU_FACTOR: Partial<Record<NutrientCode, number>> = {
  vitamin_d: 0.025,
  vitamin_a: 0.3,
};

/**
 * The tolerable upper intake levels for adults, from EFSA's overview of the
 * tolerable upper intake levels (2024 edition), each citing the opinion it
 * rests on. A code that is absent has no established UL: EFSA set none
 * (vitamin C, K, B1, B2, B5, B12, biotin, phosphorus, chromium), set a safe
 * level of intake instead of a UL (iron 2024, manganese 2023), or set one that
 * depends on a chemical form the composition cannot say (niacin: nicotinic
 * acid 10 mg, nicotinamide 900 mg). EPA and DHA have none: EFSA (2012) found
 * supplemental intakes up to 5 g a day of both combined raise no concern, which
 * is a statement about the pair, not a per-nutrient limit.
 */
const UPPER_LIMITS: Partial<Record<NutrientCode, NutrientUpperLimit>> = {
  vitamin_a: {
    value: 3000,
    unit: "ug",
    scope: "total",
    source:
      "EFSA UL overview 2024 (SCF 2002): preformed vitamin A (retinol), adults",
  },
  vitamin_b6: {
    value: 12,
    unit: "mg",
    scope: "total",
    source: "EFSA UL overview 2024 (NDA Panel 2023): adults",
  },
  folate: {
    value: 1000,
    unit: "ug",
    scope: "supplemental",
    source:
      "EFSA UL overview 2024 (NDA Panel 2023): folic acid from supplements and fortified foods, adults",
  },
  vitamin_d: {
    value: 100,
    unit: "ug",
    scope: "total",
    source: "EFSA UL overview 2024 (NDA Panel 2023): adults",
  },
  vitamin_e: {
    value: 300,
    unit: "mg",
    scope: "total",
    source: "EFSA UL overview 2024 (NDA Panel 2024): alpha-tocopherol, adults",
  },
  calcium: {
    value: 2500,
    unit: "mg",
    scope: "total",
    source: "EFSA UL overview 2024 (NDA Panel 2012): adults",
  },
  magnesium: {
    value: 250,
    unit: "mg",
    scope: "supplemental",
    source:
      "EFSA UL overview 2024 (SCF 2001): readily dissociable magnesium salts in supplements, adults",
  },
  zinc: {
    value: 25,
    unit: "mg",
    scope: "total",
    source: "EFSA UL overview 2024 (SCF 2003): adults",
  },
  copper: {
    value: 5,
    unit: "mg",
    scope: "total",
    source: "EFSA UL overview 2024 (SCF 2003): adults",
  },
  selenium: {
    value: 255,
    unit: "ug",
    scope: "total",
    source: "EFSA UL overview 2024 (NDA Panel 2023): adults",
  },
  molybdenum: {
    value: 600,
    unit: "ug",
    scope: "total",
    source: "EFSA UL overview 2024 (SCF 2000): adults",
  },
  iodine: {
    value: 600,
    unit: "ug",
    scope: "total",
    source: "EFSA UL overview 2024 (SCF 2002): adults",
  },
};

function inputUnitsFor(
  code: NutrientCode,
  unit: NutrientUnit,
): ReadonlyArray<NutrientInputUnit> {
  const iu = IU_FACTOR[code];
  return iu === undefined
    ? METRIC_INPUT_UNITS[unit]
    : [
        ...METRIC_INPUT_UNITS[unit],
        { unit: NUTRIENT_UNIT.IU, factorToCanonical: iu },
      ];
}

function def(
  code: NutrientCode,
  hkSuffix: string,
  unit: NutrientUnit,
  plausibleDailyMax: number,
  reference: NutrientReference,
): NutrientDefinition {
  return {
    code,
    hkIdentifier: `HKQuantityTypeIdentifierDietary${hkSuffix}`,
    syncable: true,
    unit,
    labelKey: `nutrients.names.${code}`,
    plausibleDailyMax,
    reference,
    inputUnits: inputUnitsFor(code, unit),
    upperLimit: UPPER_LIMITS[code] ?? null,
  };
}

/** A code that only a supplement's composition produces (v1.43). */
function supplementOnly(
  code: NutrientCode,
  unit: NutrientUnit,
  plausibleDailyMax: number,
): NutrientDefinition {
  return {
    code,
    hkIdentifier: null,
    syncable: false,
    unit,
    labelKey: `nutrients.names.${code}`,
    plausibleDailyMax,
    // EFSA's adequate intake for these (250 mg a day) is set for EPA and DHA
    // combined, so neither code carries a reference of its own.
    reference: null,
    inputUnits: inputUnitsFor(code, unit),
    upperLimit: UPPER_LIMITS[code] ?? null,
  };
}

export const NUTRIENT_CATALOG: Readonly<
  Record<NutrientCode, NutrientDefinition>
> = Object.freeze({
  // ── Vitamins ─────────────────────────────────────────────────────
  vitamin_a: def("vitamin_a", "VitaminA", "ug", 15000, {
    kind: "PRI",
    direction: "target",
    male: 750,
    female: 650,
    source: "EFSA DRV 2015 (retinol equivalents, adults)",
  }),
  // The cap is 500, not the 1000 the other B-vitamins carry, because thiamin's
  // PRI is exactly 1.0 mg: a µg-read-as-mg sample lands on exactly 1000, and
  // the ingest guard compares with `>`, so a 1000× error slipped through at
  // precisely this one analyte. 500 still clears any real supplement dose
  // (high-dose thiamin tops out around 300 mg) while catching that collision.
  thiamin: def("thiamin", "Thiamin", "mg", 500, {
    kind: "PRI",
    direction: "target",
    adult: 1.0,
    source: "EFSA DRV 2016 (PRI 0.1 mg/MJ ≈ 1.0 mg/d at 10 MJ/d)",
  }),
  riboflavin: def("riboflavin", "Riboflavin", "mg", 1000, {
    kind: "PRI",
    direction: "target",
    adult: 1.6,
    source: "EFSA DRV 2017 (adults)",
  }),
  niacin: def("niacin", "Niacin", "mg", 3000, {
    kind: "PRI",
    direction: "target",
    adult: 16,
    source: "EFSA DRV 2014 (PRI 1.6 mg NE/MJ ≈ 16 mg NE/d at 10 MJ/d)",
  }),
  pantothenic_acid: def("pantothenic_acid", "PantothenicAcid", "mg", 2000, {
    kind: "AI",
    direction: "target",
    adult: 5,
    source: "EFSA DRV 2014 (adults)",
  }),
  vitamin_b6: def("vitamin_b6", "VitaminB6", "mg", 1000, {
    kind: "PRI",
    direction: "target",
    male: 1.7,
    female: 1.6,
    source: "EFSA DRV 2016 (adults)",
  }),
  biotin: def("biotin", "Biotin", "ug", 20000, {
    kind: "AI",
    direction: "target",
    adult: 40,
    source: "EFSA DRV 2014 (adults)",
  }),
  folate: def("folate", "Folate", "ug", 5000, {
    kind: "PRI",
    direction: "target",
    adult: 330,
    source: "EFSA DRV 2014 (dietary folate equivalents, adults)",
  }),
  vitamin_b12: def("vitamin_b12", "VitaminB12", "ug", 5000, {
    kind: "AI",
    direction: "target",
    adult: 4,
    source: "EFSA DRV 2015 (cobalamin, adults)",
  }),
  vitamin_c: def("vitamin_c", "VitaminC", "mg", 10000, {
    kind: "PRI",
    direction: "target",
    male: 110,
    female: 95,
    source: "EFSA DRV 2013 (adults)",
  }),
  vitamin_d: def("vitamin_d", "VitaminD", "ug", 1000, {
    kind: "AI",
    direction: "target",
    adult: 15,
    source: "EFSA DRV 2016 (adults, assuming minimal cutaneous synthesis)",
  }),
  vitamin_e: def("vitamin_e", "VitaminE", "mg", 2000, {
    kind: "AI",
    direction: "target",
    male: 13,
    female: 11,
    source: "EFSA DRV 2015 (alpha-tocopherol, adults)",
  }),
  vitamin_k: def("vitamin_k", "VitaminK", "ug", 10000, {
    kind: "AI",
    direction: "target",
    adult: 70,
    source: "EFSA DRV 2017 (phylloquinone, adults)",
  }),
  // ── Minerals ─────────────────────────────────────────────────────
  calcium: def("calcium", "Calcium", "mg", 5000, {
    kind: "PRI",
    direction: "target",
    adult: 950,
    source: "EFSA DRV 2015 (adults ≥ 25 y)",
  }),
  iron: def("iron", "Iron", "mg", 500, {
    kind: "PRI",
    direction: "target",
    male: 11,
    female: 16,
    source: "EFSA DRV 2015 (adults; 16 mg premenopausal women)",
  }),
  magnesium: def("magnesium", "Magnesium", "mg", 2000, {
    kind: "AI",
    direction: "target",
    male: 350,
    female: 300,
    source: "EFSA DRV 2015 (adults)",
  }),
  phosphorus: def("phosphorus", "Phosphorus", "mg", 5000, {
    kind: "AI",
    direction: "target",
    adult: 550,
    source: "EFSA DRV 2015 (adults)",
  }),
  zinc: def("zinc", "Zinc", "mg", 200, {
    kind: "PRI",
    direction: "target",
    male: 9.4,
    female: 7.5,
    source: "EFSA DRV 2014 (adults, at 300 mg/d phytate intake)",
  }),
  copper: def("copper", "Copper", "mg", 20, {
    kind: "AI",
    direction: "target",
    male: 1.6,
    female: 1.3,
    source: "EFSA DRV 2015 (adults)",
  }),
  manganese: def("manganese", "Manganese", "mg", 50, {
    kind: "AI",
    direction: "target",
    adult: 3,
    source: "EFSA DRV 2013 (adults)",
  }),
  selenium: def("selenium", "Selenium", "ug", 1000, {
    kind: "AI",
    direction: "target",
    adult: 70,
    source: "EFSA DRV 2014 (adults)",
  }),
  chromium: def("chromium", "Chromium", "ug", 2000, {
    kind: "AI",
    direction: "target",
    male: 35,
    female: 25,
    source: "NIH ODS 2018 (adults 19–50 y; EFSA 2014 sets no DRV for chromium)",
  }),
  molybdenum: def("molybdenum", "Molybdenum", "ug", 2000, {
    kind: "AI",
    direction: "target",
    adult: 65,
    source: "EFSA DRV 2013 (adults)",
  }),
  iodine: def("iodine", "Iodine", "ug", 2000, {
    kind: "AI",
    direction: "target",
    adult: 150,
    source: "EFSA DRV 2014 (adults)",
  }),
  // ── Taken substances with correlation value ──────────────────────
  water: def("water", "Water", "ml", 20000, {
    kind: "AI",
    direction: "target",
    male: 2500,
    female: 2000,
    source: "EFSA DRV 2010 (total water incl. food moisture, adults)",
  }),
  caffeine: def("caffeine", "Caffeine", "mg", 2000, {
    kind: "safeLevel",
    direction: "upperGuidance",
    adult: 400,
    source: "EFSA 2015 scientific opinion on the safety of caffeine (adults)",
  }),
  // ── Supplement-only (v1.43) ──────────────────────────────────────
  // Omega-3 fatty acids from fish or algae oil capsules. The cap sits well
  // above the 5 g a day EFSA reviewed, so only a unit slip trips it.
  dha: supplementOnly("dha", "mg", 20000),
  epa: supplementOnly("epa", "mg", 20000),
});

/** Catalog rows in canonical display order (the tuple order above). */
export const NUTRIENT_DEFINITIONS: ReadonlyArray<NutrientDefinition> =
  NUTRIENT_CODES.map((code) => NUTRIENT_CATALOG[code]);

const NUTRIENT_CODE_SET: ReadonlySet<string> = new Set(NUTRIENT_CODES);

/** True when `code` is a known catalog code. */
export function isNutrientCode(code: string): code is NutrientCode {
  return NUTRIENT_CODE_SET.has(code);
}

const SYNCABLE_CODE_SET: ReadonlySet<string> = new Set(SYNCABLE_NUTRIENT_CODES);

/** True when HealthKit may send `code` in the nutrient batch. */
export function isSyncableNutrientCode(
  code: string,
): code is SyncableNutrientCode {
  return SYNCABLE_CODE_SET.has(code);
}

/**
 * A code's catalogue entry with its position in display order, or `null` for
 * a code the catalogue does not know.
 */
export function catalogEntryFor(
  code: string,
): (NutrientDefinition & { order: number }) | null {
  if (!isNutrientCode(code)) return null;
  return { ...NUTRIENT_CATALOG[code], order: NUTRIENT_CODES.indexOf(code) };
}

/** Round away binary noise from a unit factor (1000 IU × 0.025 = 25 µg). */
function roundAmount(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * v1.43 — convert an entered amount to the code's canonical unit. `null` when
 * `unit` is not one of the code's input units: the caller refuses, it never
 * guesses. This is the only unit conversion for nutrient amounts.
 */
export function toCanonicalNutrientAmount(
  code: NutrientCode,
  amount: number,
  unit: string,
): number | null {
  const input = NUTRIENT_CATALOG[code].inputUnits.find((u) => u.unit === unit);
  if (!input) return null;
  return roundAmount(amount * input.factorToCanonical);
}

/** Whether `unit` is the code's canonical unit (nothing to convert). */
export function isCanonicalNutrientUnit(
  code: NutrientCode,
  unit: string,
): boolean {
  return NUTRIENT_CATALOG[code].unit === unit;
}

/**
 * v1.43 — whether a day is above the code's upper limit. `total` is the day's
 * sum across sources; `supplemental` the part from taken supplement doses.
 * `null` when the code has no upper limit, so "not above" and "no limit to be
 * above" stay two different answers.
 */
export function isAboveUpperLimit(
  code: NutrientCode,
  amounts: { total: number; supplemental: number },
): boolean | null {
  const limit = NUTRIENT_CATALOG[code].upperLimit;
  if (!limit) return null;
  const compared =
    limit.scope === "supplemental" ? amounts.supplemental : amounts.total;
  return compared > limit.value;
}

/** A catalog reference resolved to one concrete number for a profile. */
export interface ResolvedNutrientReference {
  kind: NutrientReference["kind"];
  direction: NutrientReference["direction"];
  value: number;
  source: string;
}

/**
 * Resolve a catalog reference against the user's profile sex (v1.29).
 *
 * `adult` values (uniform across sexes) resolve unconditionally. A
 * sex-split reference (`male` / `female`, no `adult`) resolves only
 * when `sex` is known — a profile without sex on file OMITS the
 * reference rather than guessing, the catalog's own documented
 * contract (see the module docblock). Every insights surface honours
 * this: no reference line, no meta sentence, nothing inferred.
 */
export function resolveNutrientReference(
  code: NutrientCode,
  sex: BinaryReferenceSex | null,
): ResolvedNutrientReference | null {
  const ref = NUTRIENT_CATALOG[code].reference;
  if (!ref) return null;
  const value =
    ref.adult ??
    (sex === "MALE" ? ref.male : sex === "FEMALE" ? ref.female : undefined);
  if (value === undefined) return null;
  return {
    kind: ref.kind,
    direction: ref.direction,
    value,
    source: ref.source,
  };
}
