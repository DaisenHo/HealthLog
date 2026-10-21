/**
 * The statistics behind the correlation, trend and changepoint surfaces are
 * computed without a model.
 *
 * These modules answer "what does the record show": correlation channels,
 * lab slopes and projected band exits, screener change against the
 * clinically meaningful threshold, training load, level shifts. None of that
 * may depend on a provider being configured, and none of it may become a way
 * to reach one. A capability gate cannot protect a computation that quietly
 * imports the provider chain, so this guard walks each module's import
 * closure (value imports, `@/` and relative, through re-exports) and fails on
 * anything under `lib/ai/` except the byte cipher the symptom decrypt uses,
 * and on any provider call in the module's own text.
 *
 * Limits, stated: a dynamic `import()` or a `require` is not followed, and a
 * type-only import is skipped by design (it carries no code). The list below
 * is the set this guard covers; a new analysis module joins it by being added.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const SRC = join(process.cwd(), "src");

/** The analysis modules held to "no model anywhere below". */
const ANALYSIS_MODULES = [
  "lib/insights/correlation-discovery.ts",
  "lib/insights/correlation-series-builders.ts",
  "lib/insights/correlation-channel-series.ts",
  "lib/insights/discovery-matrix.ts",
  "lib/insights/derived/changepoint.ts",
  "lib/labs/lab-trend.ts",
  "lib/mental-health/assessment-trend.ts",
  "lib/insights/training-load.ts",
] as const;

/** Reachable under `lib/ai/` without being a model: the at-rest cipher. */
const AI_TREE_ALLOWED = new Set(["lib/ai/coach/bytes-codec.ts"]);

/** A provider call, as `ai-egress-capability-guard` defines it. */
const EGRESS_CALL =
  /\.generateCompletion(?:Stream)?\s*\(|\brunRawCompletionWithFallback\s*\(|\brunWithFallback\s*\(/;

const VALUE_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/g;

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function closure(entry: string): string[] {
  const seen = new Set<string>();
  const stack = [join(SRC, entry)];
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    // The generated Prisma client is never read (several MB, no model in it).
    if (file.includes(`${SRC}/generated/`)) continue;
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(VALUE_IMPORT)) {
      const next = resolveImport(file, match[1]);
      if (next) stack.push(next);
    }
  }
  return [...seen].map((f) => relative(SRC, f));
}

describe("the analysis modules compute without a model", () => {
  it.each(ANALYSIS_MODULES)("%s reaches no provider", (entry) => {
    const reached = closure(entry);
    // A walk that found nothing would pass any assertion below.
    expect(reached.length).toBeGreaterThan(1);
    const ai = reached.filter(
      (f) => f.startsWith("lib/ai/") && !AI_TREE_ALLOWED.has(f),
    );
    expect(ai).toEqual([]);
  });

  it.each(ANALYSIS_MODULES)("%s makes no provider call", (entry) => {
    expect(readFileSync(join(SRC, entry), "utf8")).not.toMatch(EGRESS_CALL);
  });

  it("would notice a provider import", () => {
    // The walk follows the provider module itself into the chain.
    expect(closure("lib/ai/provider.ts").length).toBeGreaterThan(1);
    expect(
      closure("lib/ai/provider.ts").some(
        (f) => f === "lib/ai/provider-chain.ts",
      ),
    ).toBe(true);
  });
});
