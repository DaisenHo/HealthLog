/**
 * Which analyte a marker is, for the unit conversion.
 *
 * `matchAnalyteKey` answers from two places: the localised names of the
 * catalog seeds the registry knows (so a marker created from the "pick a common
 * marker" list is recognised in every language the app ships) and the alias
 * list in the catalog. The name must equal one of them as a WHOLE, folded the
 * same way on both sides; a part of a name never matches.
 *
 * Two safeguards keep a link from being wrong:
 *   - a folded name that two analytes claim matches neither;
 *   - the marker's own unit must be one the analyte reaches, so a marker called
 *     "Glucose" in a unit the registry cannot convert is left unlinked.
 *
 * Returns the catalog slug the name was recognised as (`ldl`, `hdl`,
 * `fasting-glucose`), or the registry-only key for an analyte with no seed
 * (`urea`, `uric-acid`), or null. LDL stays `ldl` even though the registry
 * converts it with the cholesterol entry: the key says which marker this is,
 * and `analyteConversionFor` resolves it to its entry. Pure apart from reading
 * the message bundles once.
 */
import { foldForMatch } from "@/lib/i18n/fold-for-match";
import { localisedValues } from "@/lib/i18n/shared-resolve";

import {
  ANALYTE_ALIASES,
  BIOMARKER_CATALOG,
  LAB_NAME_ALIASES,
} from "./biomarker-catalog";
import { analyteAcceptsUnit } from "./unit-conversion/convert";
import { analyteConversionFor } from "./unit-conversion/registry";

/** The folded name without a trailing parenthetical gloss: "Vitamin D (25-OH)" -> "vitamin d". */
function withoutGloss(folded: string): string {
  return folded.replace(/\s*\([^)]*\)/gu, "").trim();
}

let cache: ReadonlyMap<string, string> | null = null;

/**
 * folded name -> analyte key, with every name two keys claim removed.
 * Exported for the guard test, which asserts nothing was dropped silently.
 */
export function analyteNameIndex(): {
  index: ReadonlyMap<string, string>;
  ambiguous: readonly string[];
} {
  const claims = new Map<string, Set<string>>();
  const claim = (name: string, key: string) => {
    const folded = foldForMatch(name);
    if (!folded) return;
    const keys = claims.get(folded) ?? new Set<string>();
    keys.add(key);
    claims.set(folded, keys);
  };

  for (const seed of BIOMARKER_CATALOG) {
    if (!analyteConversionFor(seed.slug)) continue;
    for (const name of localisedValues(`labs.catalog.${seed.slug}`)) {
      claim(name, seed.slug);
      // The bare name too, for a marker typed without the app's gloss.
      claim(withoutGloss(foldForMatch(name)), seed.slug);
    }
  }
  for (const { key, names } of ANALYTE_ALIASES) {
    if (!analyteConversionFor(key)) continue;
    for (const name of names) claim(name, key);
  }

  const index = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const [folded, keys] of claims) {
    if (keys.size === 1) index.set(folded, [...keys][0]);
    else ambiguous.push(folded);
  }
  return { index, ambiguous };
}

export function matchAnalyteKey(input: {
  name: string;
  unit: string;
}): string | null {
  cache ??= analyteNameIndex().index;
  const key =
    cache.get(foldForMatch(input.name)) ??
    cache.get(foldWithoutDots(input.name));
  if (!key) return null;
  return analyteAcceptsUnit(key, input.unit) ? key : null;
}

/**
 * The fold with every full stop and comma read as a space as well: lab
 * shorthand is printed "Alk.P", "T.Bili", "Bilirubin, total", and the dot or
 * comma carries no meaning there. Applied to both sides, like the fold itself.
 */
export function foldWithoutDots(raw: string): string {
  return foldForMatch(raw).replace(/[.,]/gu, " ").replace(/\s+/gu, " ").trim();
}

let catalogCache: ReadonlyMap<string, string> | null = null;
let catalogNamesCache: ReadonlyMap<string, readonly string[]> | null = null;

/**
 * Which catalog analyte a NAME is, for telling two markers of one account
 * apart from two spellings of one marker (D1223). Unlike `analyteNameIndex`
 * this needs no conversion: "GPT" and "ALT" are one analyte whether or not
 * the registry can move it between units, so every seed, every alias in
 * `ANALYTE_ALIASES` and every name in `LAB_NAME_ALIASES` claims here, folded
 * with and without dots. A name two analytes claim matches neither.
 * Exported for the guard test.
 */
export function catalogNameIndex(): {
  index: ReadonlyMap<string, string>;
  ambiguous: readonly string[];
} {
  const claims = new Map<string, Set<string>>();
  const claim = (folded: string, key: string) => {
    if (!folded) return;
    const keys = claims.get(folded) ?? new Set<string>();
    keys.add(key);
    claims.set(folded, keys);
  };
  const claimName = (name: string, key: string) => {
    claim(foldForMatch(name), key);
    claim(foldWithoutDots(name), key);
  };

  for (const seed of BIOMARKER_CATALOG) {
    for (const name of localisedValues(`labs.catalog.${seed.slug}`)) {
      claimName(name, seed.slug);
      claim(withoutGloss(foldForMatch(name)), seed.slug);
    }
  }
  for (const { key, names } of [...ANALYTE_ALIASES, ...LAB_NAME_ALIASES]) {
    for (const name of names) claimName(name, key);
  }

  const index = new Map<string, string>();
  const ambiguous: string[] = [];
  for (const [folded, keys] of claims) {
    if (keys.size === 1) index.set(folded, [...keys][0]);
    else ambiguous.push(folded);
  }
  return { index, ambiguous };
}

/**
 * Qualifiers that may stand in parentheses after a name without making it a
 * different measurement: "Bilirubin (Total)", "Kreatinin (Serum)". Anything
 * else in parentheses names something else ("Calcium (ionisiert)", "Glucose
 * (urine)") and keeps the name unmatched.
 */
const NEUTRAL_GLOSSES = new Set([
  "total",
  "totale",
  "totales",
  "gesamt",
  "serum",
  "s",
  "plasma",
  "blood",
  "blut",
  "sang",
  "sangre",
  "sangue",
  "krew",
]);

function lookupWhole(name: string): string | null {
  catalogCache ??= catalogNameIndex().index;
  return (
    catalogCache.get(foldForMatch(name)) ??
    catalogCache.get(foldWithoutDots(name)) ??
    null
  );
}

/**
 * The catalog analyte a name belongs to, or null. Whole names only, with one
 * allowance for a trailing parenthetical: it is read when it names the same
 * analyte as the rest ("GPT (ALT)") or is a neutral qualifier ("Bilirubin
 * (Total)"), and never otherwise.
 */
export function catalogKeyForName(name: string): string | null {
  const whole = lookupWhole(name);
  if (whole) return whole;
  const glossed = /^(.+?)\s*\(([^()]+)\)\s*$/u.exec(name.trim());
  if (!glossed) return null;
  const outer = lookupWhole(glossed[1]);
  if (!outer) return null;
  const gloss = glossed[2];
  if (NEUTRAL_GLOSSES.has(foldWithoutDots(gloss))) return outer;
  return lookupWhole(gloss) === outer ? outer : null;
}

/** Every folded name the catalog knows for one analyte, for suggestions. */
export function catalogNamesForKey(key: string): readonly string[] {
  if (!catalogNamesCache) {
    catalogCache ??= catalogNameIndex().index;
    const byKey = new Map<string, string[]>();
    for (const [folded, k] of catalogCache) {
      const list = byKey.get(k) ?? [];
      list.push(folded);
      byKey.set(k, list);
    }
    catalogNamesCache = byKey;
  }
  return catalogNamesCache.get(key) ?? [];
}
