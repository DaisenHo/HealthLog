import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * GUARD — no insights page passes an English word as a unit.
 *
 * A German reader was shown "13,387.6 steps" because `/insights/steps`
 * handed the scaffold the literal string `steps`. Five of the eighteen unit
 * literals under `src/app/insights` were English words: steps, years,
 * flights, falls, and a "count" that was a poor label in any language. The
 * other thirteen are language-neutral symbols — bpm, %, mmHg, m/s and their
 * kin read the same in every locale, and "translating" one would be the
 * opposite mistake.
 *
 * So the rule is not "route every unit through i18n", it is: a unit literal
 * on an insights page must be a SYMBOL. A word travels as an i18n key
 * (`unitKey`) and is resolved by the scaffold — and that key must resolve in
 * every locale, which the `t()`-call-site coverage sweep cannot see because
 * the key is a prop, not a call argument. Both halves are asserted here.
 */

const LOCALES = ["en", "de", "es", "fr", "it", "pl", "ko"] as const;
const INSIGHTS_PAGES_DIR = join(process.cwd(), "src/app/insights");

/**
 * Unit strings that are language-neutral and therefore legitimately appear
 * as literals. Every entry is a symbol, an SI abbreviation, or a composed
 * one — nothing here changes when the reader's locale does. The empty string
 * is the "this metric has no unit" case (pain score, waist-to-height ratio).
 */
const LANGUAGE_NEUTRAL_UNITS = new Set([
  "",
  "%",
  "/10",
  "bpm",
  "dBA",
  "kcal",
  "kg/m²",
  "m",
  "m/s",
  "mL/(kg·min)",
  "min",
  "mmHg",
  "ms",
]);

/** Every `page.tsx` beneath `src/app/insights`, recursively. */
function insightsPageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...insightsPageFiles(full));
    } else if (entry === "page.tsx") {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `unit="…"` / `yAxisUnit="…"` STRING literal in a source file.
 * Expression props (`unit={glucoseUnit}`) resolve at runtime from a unit
 * preference or an i18n call and are out of scope by construction.
 */
function unitLiterals(source: string): string[] {
  return [...source.matchAll(/\b(?:yAxisUnit|unit)="([^"]*)"/g)].map(
    (match) => match[1],
  );
}

/** Every `unitKey="…"` literal in a source file. */
function unitKeys(source: string): string[] {
  return [...source.matchAll(/\bunitKey="([^"]*)"/g)].map((match) => match[1]);
}

/** Resolve a dotted key against a loaded message bundle. */
function resolve(bundle: unknown, key: string): unknown {
  let node = bundle;
  for (const segment of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

describe("insights unit-literal guard", () => {
  const files = insightsPageFiles(INSIGHTS_PAGES_DIR);
  const sources = files.map((file) => ({
    path: file.slice(file.indexOf("src/")),
    source: readFileSync(file, "utf8"),
  }));

  it("finds the insights pages to scan", () => {
    // A broken walk would make every assertion below vacuously true.
    expect(files.length).toBeGreaterThan(30);
  });

  it("scans real content — the known symbols are actually present", () => {
    const seen = new Set(sources.flatMap((f) => unitLiterals(f.source)));
    // If the matcher silently stopped matching, this fails rather than the
    // offender list below going quietly empty.
    for (const symbol of ["bpm", "mmHg", "%", "m/s"]) {
      expect(seen.has(symbol), `expected to see unit="${symbol}"`).toBe(true);
    }
  });

  it("passes only language-neutral unit symbols as literals", () => {
    const offenders: string[] = [];
    for (const { path, source } of sources) {
      for (const literal of unitLiterals(source)) {
        if (!LANGUAGE_NEUTRAL_UNITS.has(literal)) {
          // A word-shaped unit belongs in `messages/*.json` behind `unitKey`.
          offenders.push(`${path}: unit="${literal}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("resolves every unitKey in all six locales", () => {
    const keys = [...new Set(sources.flatMap((f) => unitKeys(f.source)))];
    // The five words the pages actually carry.
    expect(keys.length).toBeGreaterThanOrEqual(5);

    const missing: string[] = [];
    for (const locale of LOCALES) {
      const bundle = JSON.parse(
        readFileSync(join(process.cwd(), `messages/${locale}.json`), "utf8"),
      );
      for (const key of keys) {
        const value = resolve(bundle, key);
        if (typeof value !== "string" || value.trim() === "") {
          missing.push(`${locale}: ${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

/**
 * v1.43 — no nutrient unit spelled outside the nutrient catalogue.
 *
 * A supplement's composition converts an entered amount to the catalogue's
 * canonical unit, and the nutrient reads judge a day against an upper limit
 * in that unit. A µg/mg slip is a 1000× error, and the way it gets in is a
 * second place that spells a unit or a factor: a converter that knows "IU"
 * itself, a read that compares against "mg". So the rule is that the code
 * under `src/lib/nutrients/` and `src/lib/medications/ingredients/` names no
 * unit as a string literal; units and factors come from
 * `src/lib/nutrients/catalog.ts` (`NUTRIENT_UNIT`, `inputUnits`,
 * `toCanonicalNutrientAmount`, `parseNutrientInputUnit`), the one file allowed
 * to spell them.
 */
const NUTRIENT_UNIT_DIRS = [
  join(process.cwd(), "src/lib/nutrients"),
  join(process.cwd(), "src/lib/medications/ingredients"),
];
const NUTRIENT_CATALOG_FILE = join(
  process.cwd(),
  "src/lib/nutrients/catalog.ts",
);

/** A string literal that is nothing but a nutrient unit. */
const UNIT_LITERAL =
  /(["'`])(mg|ug|µg|μg|mcg|g|kg|ml|mL|l|L|IU|IE|UI|iu|ie|ui)\1/g;

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...sourceFilesUnder(full));
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("nutrient unit-literal guard", () => {
  const files = NUTRIENT_UNIT_DIRS.flatMap(sourceFilesUnder);

  it("scans the nutrient and composition code", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files).toContain(NUTRIENT_CATALOG_FILE);
  });

  it("the matcher sees the catalogue's own spellings", () => {
    // The catalogue is where units live, so a matcher that finds nothing
    // there would make the next assertion vacuously true.
    const catalog = readFileSync(NUTRIENT_CATALOG_FILE, "utf8");
    const seen = new Set([...catalog.matchAll(UNIT_LITERAL)].map((m) => m[2]));
    for (const unit of ["mg", "ug", "IU", "ml"]) {
      expect(seen.has(unit), `expected to see "${unit}" in the catalogue`).toBe(
        true,
      );
    }
  });

  it("names no unit outside the catalogue", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === NUTRIENT_CATALOG_FILE) continue;
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(UNIT_LITERAL)) {
        offenders.push(`${file.slice(file.indexOf("src/"))}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
