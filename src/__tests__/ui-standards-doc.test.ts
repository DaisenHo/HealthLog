/**
 * The published UI standards read as public documentation.
 *
 * `docs/contributing/ui-standards.md` is the binding rulebook, linked from the
 * code. It must not carry working shorthand that only made sense in the
 * maintainer's notes, must not contradict itself on the spacing scale, and
 * follows the docs' punctuation (no em dashes).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const DOC = readFileSync(
  join(process.cwd(), "docs/contributing/ui-standards.md"),
  "utf8",
);

function section(number: number): string {
  const start = DOC.indexOf(`## ${number}. `);
  const next = DOC.indexOf("\n## ", start + 1);
  return DOC.slice(start, next < 0 ? undefined : next);
}

describe("docs/contributing/ui-standards.md", () => {
  it("has no em dashes", () => {
    expect(DOC.length).toBeGreaterThan(5000);
    expect(DOC).not.toContain("—");
  });

  it("carries no internal working shorthand", () => {
    for (const phrase of [
      /lineage/i,
      /swept on touch/i,
      /remains planned/i,
      /#\d{2,4}\b/,
    ]) {
      expect(DOC).not.toMatch(phrase);
    }
  });

  it("states the spacing scale once, in §2", () => {
    const scale = /`1 \/ 1\.5 \/ 2 \/ 2\.5 \/ 3 \/ 3\.5 \/ 4 \/ 6 \/ 8 \/ 10`/;
    expect(section(2)).toMatch(scale);
    // Every other section refers to §2 instead of listing its own copy.
    for (const n of [1, 3, 8, 13]) {
      expect(section(n), `§${n}`).not.toMatch(/`1\/1\.5\/2/);
    }
  });
});

describe("docs/migration/v1.3-to-v1.4.md", () => {
  it("does not promise a fragment redirect the server cannot see", () => {
    const doc = readFileSync(
      join(process.cwd(), "docs/migration/v1.3-to-v1.4.md"),
      "utf8",
    );
    expect(doc).toContain("Settings has moved to per-section routes");
    expect(doc).not.toMatch(/#anchor` URLs\s+still 308-redirect/);
  });
});
