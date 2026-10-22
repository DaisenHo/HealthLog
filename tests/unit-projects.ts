/**
 * Which unit-test files can share a module graph, decided from their source.
 *
 * Vitest isolates every test file by default: each one re-imports the
 * application modules it touches. In this suite that import is most of the
 * run (63 % of the 869 s CI wall time before the split), and most files do
 * not need it, because they neither replace a module nor change process
 * state. Those files run in projects with `isolate: false`, where a worker
 * keeps its module cache from one file to the next; everything else keeps
 * full isolation.
 *
 * A file needs isolation when its source does anything that outlives the
 * file in a shared graph: mocks or spies on a module, stubbed env or
 * globals, fake timers, a module reset, an assignment to `process.env` or a
 * global, or a `__reset…ForTests` hook. The match is deliberately broad; a
 * false positive costs a little speed, a false negative costs a flaky
 * neighbour. A file that turns out to need isolation for a reason this list
 * misses says so with a `// vitest-isolate` comment.
 */
import { readFileSync } from "node:fs";

const NEEDS_ISOLATION = new RegExp(
  [
    String.raw`\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|hoisted|stubEnv|stubGlobal|unstubAllEnvs|unstubAllGlobals|spyOn|useFakeTimers|setSystemTime|resetModules|importMock)\b`,
    String.raw`\bprocess\.env(?:\.\w+|\[[^\]]+\])\s*=(?!=)`,
    String.raw`\bdelete\s+process\.env`,
    String.raw`\b(?:globalThis|global|window)(?:\.\w+|\[[^\]]+\])\s*=(?!=)`,
    String.raw`Object\.defineProperty\(\s*(?:globalThis|global|window|process)`,
    String.raw`__\w*[Rr]eset\w*ForTests`,
    String.raw`process\.chdir\(`,
    String.raw`vitest-isolate`,
  ].join("|"),
);

export function needsIsolation(source: string): boolean {
  return NEEDS_ISOLATION.test(source);
}

export interface UnitProjectFiles {
  /** Structural guards that share a module graph. */
  guards: string[];
  /** Behavioural unit and component tests that share a module graph. */
  shared: string[];
  /** Everything that mocks, stubs or resets; one fresh graph per file. */
  isolated: string[];
}

const GUARD_LOCATIONS =
  /^(?:src\/__tests__\/|scripts\/__tests__\/|eslint-plugins\/|tests\/)/;

/** Split `files` (paths relative to `root`) into the three projects. */
export function classifyUnitFiles(
  root: string,
  files: readonly string[],
): UnitProjectFiles {
  const result: UnitProjectFiles = { guards: [], shared: [], isolated: [] };
  for (const file of files) {
    const source = readFileSync(`${root}/${file}`, "utf8");
    if (needsIsolation(source)) result.isolated.push(file);
    else if (GUARD_LOCATIONS.test(file)) result.guards.push(file);
    else result.shared.push(file);
  }
  return result;
}
