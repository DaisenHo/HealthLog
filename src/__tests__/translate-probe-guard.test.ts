/**
 * Whether the catalogue has a sentence is asked in one place.
 *
 * `t()` answers a missing key with the key itself, so "does this code have a
 * sentence" is a comparison of the answer with the question. Written inline it
 * was copied once per surface that wanted a code's sentence or else a
 * fallback. It lives in `src/lib/i18n/translate-code.ts` now
 * (`translateOrNull`, `translateCode`), and this guard refuses the comparison
 * anywhere else under `src/`.
 *
 * Two shapes are read: a translation held in a variable and compared with the
 * key it was asked for (`const v = t(key); v === key`), and the inline form
 * (`t(k) !== k`). The helper itself must match, so a matcher that stops
 * finding the shape fails instead of passing over nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");
const HELPER = "lib/i18n/translate-code.ts";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "generated") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test."))
      out.push(path);
  }
  return out;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The probes in one source text, one line each. */
function probes(source: string): string[] {
  const found: string[] = [];
  // Inline: `t(K) !== K` / `t(K, p) === K`, K an identifier or a template.
  const inline =
    /\bt\(\s*(`[^`]*`|[A-Za-z_$][\w$]*)\s*(?:,[^()]*)?\)\s*[!=]==\s*(`[^`]*`|[A-Za-z_$][\w$]*)/g;
  for (const m of source.matchAll(inline)) {
    if (m[1] === m[2]) found.push(m[0]);
  }
  // Held: `const v = t(K…)` (or `K ? t(K) : null`) and later `v === K` or
  // `K !== v`.
  const held =
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:[\w$.]+\s*\?\s*)?t\(\s*([A-Za-z_$][\w$]*)\b/g;
  for (const m of source.matchAll(held)) {
    const [, value, key] = m;
    const compare = new RegExp(
      `\\b${escape(value)}\\s*[!=]==\\s*${escape(key)}\\b|\\b${escape(key)}\\s*[!=]==\\s*${escape(value)}\\b`,
    );
    if (compare.test(source.slice(m.index))) found.push(m[0]);
  }
  return found;
}

const files = walk(SRC).map((file) => ({
  file: relative(SRC, file),
  source: readFileSync(file, "utf8"),
}));

describe("the catalogue probe lives in one helper", () => {
  it("recognises both shapes", () => {
    expect(probes("const s = t(key);\nreturn s === key ? a : s;")).toHaveLength(
      1,
    );
    expect(probes("if (t(`x.${c}`) !== `x.${c}`) go();")).toHaveLength(1);
    expect(
      probes("const label = t(key, params); if (key !== label) {}"),
    ).toHaveLength(1);
    expect(
      probes("const v = key ? t(key) : null; return v && v !== key ? v : f;"),
    ).toHaveLength(1);
    expect(probes("const s = t(key); return s;")).toEqual([]);
    expect(probes("if (row.key === key) {}")).toEqual([]);
  });

  it("finds the probe in the helper", () => {
    const helper = files.find(({ file }) => file === HELPER);
    expect(helper).toBeDefined();
    expect(probes(helper!.source).length).toBeGreaterThan(0);
  });

  it("finds it nowhere else", () => {
    const offenders = files
      .filter(({ file }) => file !== HELPER)
      .flatMap(({ file, source }) =>
        probes(source).map((p) => `${file}: ${p}`),
      );
    expect(offenders).toEqual([]);
  });
});
