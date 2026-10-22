import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INSTRUMENTS, INSTRUMENT_ORDER } from "../instruments";
import {
  SOURCE_WORDING,
  englishOnlyWordingKeys,
  instrumentText,
  instrumentWordingKeys,
} from "../instrument-wording";

/**
 * Validated questionnaire wording is never freely translated. A language
 * outside an instrument's validated set sees the English source, and its
 * bundle carries none of that instrument's wording, so no renderer can pick a
 * self-made translation up by accident.
 */

const ROOT = join(__dirname, "../../../..");
const MESSAGES = join(ROOT, "messages");
const LOCALES = readdirSync(MESSAGES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

function flatten(obj: unknown, prefix = "", out = new Map<string, string>()) {
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "string") out.set(key, v);
      else flatten(v, key, out);
    }
  }
  return out;
}

function bundle(locale: string): Map<string, string> {
  return flatten(
    JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), "utf8")),
  );
}

describe("instrument wording", () => {
  it("holds the English source of every instrument's wording, word for word as en.json", () => {
    const en = bundle("en");
    const expected = new Set(INSTRUMENT_ORDER.flatMap(instrumentWordingKeys));
    // PHQ-9 9 + GAD-7 7 + WHO-5 5 + SCI 8 items alone are 29 keys.
    expect(expected.size).toBeGreaterThan(29);
    expect(Object.keys(SOURCE_WORDING).sort()).toEqual([...expected].sort());
    for (const [key, text] of Object.entries(SOURCE_WORDING)) {
      expect(en.get(key), key).toBe(text);
    }
  });

  it("names PHQ-9 item 9 English-only for the languages its wording is not validated in", () => {
    for (const locale of ["nl", "pt-BR"]) {
      const keys = englishOnlyWordingKeys(locale);
      expect(keys).toContain("mentalHealth.items.phq9.9");
      expect(keys).toContain("mentalHealth.options.3");
      expect(keys).toContain("mentalHealth.functionalTitle");
      expect(keys).toContain("mentalHealth.who5Options.5");
      expect(keys).toContain("mentalHealth.stems.who5.period");
      expect(keys).toContain("mentalHealth.items.sci.1");
    }
    // German is validated for the PHQ family and the WHO-5, not the SCI.
    const de = englishOnlyWordingKeys("de");
    expect(de).not.toContain("mentalHealth.items.phq9.9");
    expect(de).toContain("mentalHealth.items.sci.1");
    expect(de).toContain("mentalHealth.sciOptions.duration.4");
    expect(englishOnlyWordingKeys("en")).toEqual([]);
  });

  it.each(LOCALES.filter((l) => l !== "en"))(
    "messages/%s.json carries no wording of an instrument it is not validated for",
    (locale) => {
      const flat = bundle(locale);
      expect(flat.size).toBeGreaterThan(3000);
      const englishOnly = englishOnlyWordingKeys(locale);
      expect(englishOnly.length).toBeGreaterThan(0);
      expect(englishOnly.filter((key) => flat.has(key))).toEqual([]);
    },
  );

  it("resolves the English source, not the bundle, outside the validated set", () => {
    const drifted = (key: string) => `TRANSLATED(${key})`;
    for (const locale of ["nl", "pt-BR"]) {
      expect(
        instrumentText("PHQ9", "mentalHealth.items.phq9.9", locale, drifted),
      ).toBe(
        "Thoughts that you would be better off dead, or of hurting yourself in some way",
      );
      expect(
        instrumentText("GAD7", "mentalHealth.options.0", locale, drifted),
      ).toBe("Not at all");
    }
    expect(
      instrumentText("SCI", "mentalHealth.items.sci.1", "fr", drifted),
    ).toBe(SOURCE_WORDING["mentalHealth.items.sci.1"]);
  });

  it("resolves the bundle's validated translation inside the validated set", () => {
    const t = (key: string) => `VALIDATED(${key})`;
    expect(instrumentText("PHQ9", "mentalHealth.items.phq9.9", "de", t)).toBe(
      "VALIDATED(mentalHealth.items.phq9.9)",
    );
    expect(instrumentText("SCI", "mentalHealth.items.sci.1", "en", t)).toBe(
      "VALIDATED(mentalHealth.items.sci.1)",
    );
  });

  it("every validated locale's bundle carries a complete set for its instruments", () => {
    for (const locale of LOCALES) {
      const flat = bundle(locale);
      for (const id of INSTRUMENT_ORDER) {
        if (!INSTRUMENTS[id].validatedItemLocales.includes(locale)) continue;
        const missing = instrumentWordingKeys(id).filter((k) => !flat.has(k));
        expect(missing, `${locale} ${id}`).toEqual([]);
      }
    }
  });
});

describe("no surface renders instrument wording through a bare t()", () => {
  // Item text, answer labels and stems must go through `instrumentText`. A
  // bare `t()` on one of these keys reads the bundle whatever the language.
  const SRC = join(ROOT, "src");
  const BARE = [
    /\bt\(\s*`mentalHealth\.items\./,
    /\bt\(\s*`mentalHealth\.stems\./,
    /\bt\(\s*`mentalHealth\.functional\./,
    /\bt\(\s*"mentalHealth\.functionalTitle"/,
    /\bt\(\s*optionLabelKey\(/,
    /\bt\(\s*itemKey\(/,
  ];

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "generated" || entry.name === "__tests__") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, out);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        out.push(path);
    }
    return out;
  }

  it("finds the two item surfaces and no bare lookup anywhere", () => {
    const files = walk(SRC);
    expect(files.length).toBeGreaterThan(500);
    const users = files.filter((f) =>
      readFileSync(f, "utf8").includes("instrumentText("),
    );
    // The wizard and the history breakdown, plus the module itself.
    expect(users.length).toBeGreaterThanOrEqual(3);
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return BARE.some((re) => re.test(src));
    });
    expect(offenders).toEqual([]);
  });
});
