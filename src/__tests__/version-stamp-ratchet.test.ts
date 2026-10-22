/**
 * No new comment that opens with a release version.
 *
 * `// v1.4.39.1 — wipe the rollup partition … Pre-fix the partition kept …`
 * is a history note: it describes a state of the code the reader cannot see,
 * and it repeats what CHANGELOG and `git log` already hold. About ten
 * thousand comment lines in the tree open that way. They stay until their
 * file is split or rewritten anyway; a mass edit would be churn. New ones do
 * not get added: say what the code does and why, and leave when it changed
 * to the history.
 *
 * A comment line counts when, after its marker (`//`, `/*`, or the `*` of a
 * block comment), it opens with `vMAJOR.MINOR[.PATCH…]`. A version later in
 * the sentence ("since v1.39 the gate …") is not an opener and is not
 * counted. The count is per file, against `baselines/version-stamp-comments.json`:
 * a file that gains one fails, a new file with one fails, and a file that
 * sheds some fails until the lower count is written back with
 * `RATCHET_WRITE=1 pnpm vitest run src/__tests__/version-stamp-ratchet.test.ts`.
 *
 * Limit, stated: it reads lines, not the parse tree, so a line inside a
 * template string that happens to start with `* v1.2` would count. None does
 * today.
 */
import { describe, expect, it } from "vitest";

import { requireFloor, walkSourceFiles } from "./helpers/source-files";
import { SRC, readSrc } from "./helpers/source-metrics";
import { runRatchet, writeBackHint } from "./helpers/ratchet";

const GUARD = "src/__tests__/version-stamp-ratchet.test.ts";

const STAMP_OPENER = /^\s*(?:\/\/+|\/\*+|\*+)\s*\(?v\d+\.\d+(?:\.\d+){0,3}\b/;

function stampCount(text: string): number {
  let n = 0;
  for (const line of text.split("\n")) if (STAMP_OPENER.test(line)) n += 1;
  return n;
}

describe("version-stamp comments", () => {
  const files = walkSourceFiles(SRC, { floor: 5000 }).filter(
    (rel) => !rel.startsWith("generated/") && !rel.endsWith(".d.ts"),
  );
  const counts: Record<string, number> = {};
  for (const rel of files) {
    const n = stampCount(readSrc(rel));
    if (n > 0) counts[rel] = n;
  }

  it("finds the stamps that are there", () => {
    requireFloor("files with a version-stamp opener", Object.keys(counts), 500);
  });

  it("gains none, and records every one that goes", () => {
    const r = runRatchet("version-stamp-comments.json", counts, {
      comment: `Comment lines that open with a release version, per file under src/. Maintained by ${GUARD}.`,
    });
    expect(
      r.grew,
      "New comment lines opening with a release version. Say what the code does and why; when it changed belongs in CHANGELOG and git.",
    ).toEqual([]);
    expect(r.stale, writeBackHint(GUARD)).toEqual([]);
  });
});

describe("the opener matcher", () => {
  it.each([
    "// v1.4.39.1 — wipe the partition",
    "  // v1.23: notes are encrypted",
    "   * v1.37.19 (#219 parity) — per-slot units",
    "/* v1.5.0 — one-shot backfill */",
    "/** v1.16.12 — stale window widened */",
  ])("counts %s", (line) => {
    expect(stampCount(line)).toBe(1);
  });

  it.each([
    "// Since v1.39 every AI decision is one resolution",
    "const v = 'v1.2.3';",
    "// version 1.2",
    "// ve1.2",
  ])("does not count %s", (line) => {
    expect(stampCount(line)).toBe(0);
  });
});
