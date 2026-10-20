/**
 * Structural guard: one Pearson correlation, one bar.
 *
 * Three implementations used to answer "how correlated are these two
 * series": the engine's `pearson` (exact p-value, `lib/insights/
 * correlations.ts`), its gated wrapper `significantPearsonCorrelation`
 * (n >= 20 and p < 0.05), and an ungated `pearsonCorrelation` that banded a
 * coefficient from |r| alone above five pairs. The ungated one fed the
 * /insights envelope and the AI feature payload, so five days of noise
 * sloping the right way reached a reader labelled "strong" there while every
 * other surface refused the same five points. It is gone; every surface goes
 * through the wrapper, and the wrapper through the engine.
 *
 * The matcher flags a function whose name says Pearson or correlation
 * coefficient, declared anywhere but the engine and the wrapper's file, and
 * any mention of the deleted name. It is a tripwire: a coefficient computed
 * inline under another name slips it. Comments are stripped first; the
 * planted cases prove it fires.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");

const HOMES = new Set([
  "lib/insights/correlations.ts",
  "lib/analytics/correlations.ts",
]);

const PEARSON_DEFINITION =
  /(?:function\s+|const\s+)\w*(?:pearson|correlationCoefficient)\w*\s*(?:=|\()/i;
const DELETED = /(?<![A-Za-z])pearsonCorrelation\b/;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(): string[] {
  return walkSourceFiles(SRC, { floor: 3000 }).filter(
    (p) =>
      !p.startsWith("generated/") &&
      !p.includes("__tests__/") &&
      !/\.test\.tsx?$/.test(p),
  );
}

describe("one Pearson correlation", () => {
  it("the matchers fire on a second implementation", () => {
    expect(PEARSON_DEFINITION.test("export function pearsonR(xs, ys) {")).toBe(
      true,
    );
    expect(PEARSON_DEFINITION.test("const quickPearson = (a, b) =>")).toBe(
      true,
    );
    expect(DELETED.test("pearsonCorrelation(pairs)")).toBe(true);
    expect(DELETED.test("significantPearsonCorrelation(pairs)")).toBe(false);
  });

  it("both homes still hold their function", () => {
    const engine = readFileSync(
      join(SRC, "lib/insights/correlations.ts"),
      "utf8",
    );
    const wrapper = readFileSync(
      join(SRC, "lib/analytics/correlations.ts"),
      "utf8",
    );
    expect(engine).toMatch(/export function pearson\s*\(/);
    expect(wrapper).toMatch(
      /export function significantPearsonCorrelation\s*\(/,
    );
  });

  it("no other file defines a Pearson coefficient or calls the deleted one", () => {
    // The homes match the definition matcher, so a matcher gone blind fails here.
    const definers = sourceFiles().filter((file) =>
      PEARSON_DEFINITION.test(
        stripComments(readFileSync(join(SRC, file), "utf8")),
      ),
    );
    expect(definers.length).toBeGreaterThanOrEqual(2);

    const offenders = sourceFiles().filter((file) => {
      const code = stripComments(readFileSync(join(SRC, file), "utf8"));
      if (DELETED.test(code)) return true;
      return !HOMES.has(file) && PEARSON_DEFINITION.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
