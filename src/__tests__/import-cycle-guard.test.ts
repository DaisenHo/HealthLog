/**
 * No new runtime import cycle, and no new re-export-only module.
 *
 * A value-import cycle means module evaluation order decides whether a
 * binding is initialised when it is first read, and it ties the modules in
 * it into one unit nobody can load or split alone. The graph here is the
 * runtime one: static imports and re-exports that are not type-only,
 * side-effect imports, and dynamic `import("…")` with a literal specifier
 * (a lazy edge still loads the module into the same process). `import type`
 * is erased and left out. Modules are resolved with the TypeScript compiler
 * under the app's `@/*` mapping (`helpers/source-metrics.ts`).
 *
 * Two baselines in `baselines/import-cycles.json`:
 *
 *   - the cycle count, as a depth-first walk in sorted order meets them (one
 *     per back edge, the number `madge --circular` reports);
 *   - the strongly connected components, member by member.
 *
 * A component that is new, or gained a member, fails: that is a new cycle,
 * whatever the count says. A count above the baseline fails. A count below
 * it, or a component that lost members, fails until the lower state is
 * written back with
 * `RATCHET_WRITE=1 pnpm vitest run src/__tests__/import-cycle-guard.test.ts`.
 * The target is zero.
 *
 * A re-export-only module (every statement an `export … from`) is a facade:
 * it is where most of the cycles above came from, because children of a
 * split module import back through the old file. Existing ones are listed
 * in `baselines/reexport-only-modules.json`; a new one fails. Import the
 * module that defines the binding instead.
 */
import { describe, expect, it } from "vitest";

import { requireFloor } from "./helpers/source-files";
import {
  backEdgeCycles,
  buildImportGraph,
  productionSources,
  stronglyConnected,
} from "./helpers/source-metrics";
import {
  readBaselineJson,
  runRatchet,
  writeBackHint,
  writeBaselineJson,
} from "./helpers/ratchet";

const GUARD = "src/__tests__/import-cycle-guard.test.ts";
const CYCLES_FILE = "import-cycles.json";

interface CycleBaseline {
  $comment: string;
  cycles: number;
  components: string[][];
}

describe("runtime import cycles", () => {
  const files = productionSources();
  const graph = buildImportGraph(files);
  const components = stronglyConnected(graph.edges);
  const cycles = backEdgeCycles(graph.edges);

  it("builds a graph of the whole tree", () => {
    expect(graph.edges.size).toBeGreaterThan(3000);
    expect(graph.resolved).toBeGreaterThan(15_000);
  });

  it("adds no cycle and leaves no improvement unrecorded", () => {
    if (process.env.RATCHET_WRITE === "1") {
      const old = readBaselineJson<CycleBaseline>(CYCLES_FILE) ?? {
        $comment: `Runtime import cycles under src/: the back-edge count and the strongly connected components. Maintained by ${GUARD}.`,
        cycles: cycles.length,
        components,
      };
      const kept = old.components
        .map((c) => c.filter((m) => components.some((now) => now.includes(m))))
        .filter((c) => c.length > 1);
      writeBaselineJson(CYCLES_FILE, {
        $comment: old.$comment,
        cycles: Math.min(old.cycles, cycles.length),
        components: kept,
      });
    }
    const baseline = readBaselineJson<CycleBaseline>(CYCLES_FILE);
    if (!baseline) throw new Error(`${CYCLES_FILE} is missing`);

    const grown = components.filter(
      (c) => !baseline.components.some((b) => c.every((m) => b.includes(m))),
    );
    expect(
      grown.map((c) => c.join(" <-> ")),
      "A new runtime import cycle (or a known one that drew in another " +
        "module). Break it: move the shared piece into a leaf module, turn " +
        "the edge into `import type` if only a type crosses, or import the " +
        "defining module instead of a facade.",
    ).toEqual([]);
    expect(
      cycles.length,
      `Runtime import cycles: ${cycles.map((c) => c.join(" -> ")).join("; ")}`,
    ).toBeLessThanOrEqual(baseline.cycles);

    const shrunk = baseline.components.filter(
      (b) => !components.some((c) => b.every((m) => c.includes(m))),
    );
    expect(
      shrunk.map((c) => c.join(" <-> ")),
      writeBackHint(GUARD),
    ).toEqual([]);
    expect(cycles.length, writeBackHint(GUARD)).toBe(baseline.cycles);
  });

  it("adds no re-export-only module", () => {
    requireFloor("re-export-only modules", graph.reexportOnly, 1);
    const r = runRatchet(
      "reexport-only-modules.json",
      Object.fromEntries(graph.reexportOnly.map((rel) => [rel, 1])),
      {
        comment: `Modules under src/ whose every statement is an export … from. Maintained by ${GUARD}.`,
      },
    );
    expect(
      r.grew,
      "A new re-export-only module. Import the module that defines the binding instead of adding a facade.",
    ).toEqual([]);
    expect(r.stale, writeBackHint(GUARD)).toEqual([]);
  });
});

describe("the cycle finder", () => {
  const graphOf = (edges: Record<string, string[]>) =>
    new Map(Object.entries(edges));

  it("finds a two-module and a three-module cycle, and nothing in a tree", () => {
    const g = graphOf({
      a: ["b"],
      b: ["a", "c"],
      c: ["d"],
      d: ["e"],
      e: ["c"],
      f: ["a"],
    });
    expect(stronglyConnected(g)).toEqual([
      ["a", "b"],
      ["c", "d", "e"],
    ]);
    expect(backEdgeCycles(g)).toHaveLength(2);
    expect(stronglyConnected(graphOf({ a: ["b"], b: ["c"], c: [] }))).toEqual(
      [],
    );
  });
});
