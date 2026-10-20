/**
 * A grade chip goes through `ScorePill` (`src/components/ui/score-pill.tsx`).
 *
 * Eleven chips that state a grade beside a reading (confidence, score gain,
 * band, lab range) were hand-rolled in two looks: a /15 wash without border
 * in the crosstabs, a /10 wash with a /40 border on the correlation and trend
 * cards, and the middle confidence step was blue on one and amber on the
 * other. This guard keeps a new copy of the chip from appearing beside the
 * primitive.
 *
 * Matched: one string literal that combines the pill shape (`rounded-full`,
 * a small padding `px-1.5|2|2.5`, `text-xs|2xs`) with a semantic tone wash
 * (`bg-success|info|warning|destructive/10|15`). A neutral `bg-muted` chip is
 * `TagChip`'s business, not this guard's.
 *
 * Not matched: a tone assembled at runtime from a map whose entries live in
 * another literal. The guard catches the idiom, not every way to paint one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(__dirname, "..");

const ALLOWED: Record<string, string> = {
  // A link to the release notes styled as a call to action, not a grade.
  "components/admin/version-tile-section.tsx":
    "update-available link, not a grade",
};

const LITERAL_RE = /["'`]([^"'`\n]*\brounded-full\b[^"'`\n]*)["'`]/g;

function isGradeChip(cls: string): boolean {
  return (
    /(?:^|\s)px-(?:1\.5|2|2\.5)(?:\s|$)/.test(cls) &&
    /(?:^|\s)text-(?:xs|2xs)(?:\s|$)/.test(cls) &&
    /(?:^|\s)bg-(?:success|info|warning|destructive)\/1[05](?:\s|$)/.test(cls)
  );
}

function findGradeChips(files: { path: string; source: string }[]): string[] {
  const hits = new Set<string>();
  for (const { path, source } of files) {
    for (const match of source.matchAll(LITERAL_RE)) {
      if (isGradeChip(match[1])) hits.add(path);
    }
  }
  return [...hits].sort();
}

describe("grade chips go through ScorePill", () => {
  const files = walkSourceFiles(SRC, { floor: 2500 })
    .filter(
      (p) =>
        (p.startsWith("components/") || p.startsWith("app/")) &&
        !p.startsWith("components/ui/") &&
        !p.includes("__tests__/"),
    )
    .map((path) => ({ path, source: readFileSync(join(SRC, path), "utf8") }));

  it("walks the UI tree", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  it("has no hand-rolled grade chip outside the allowlist", () => {
    expect(findGradeChips(files).filter((p) => !(p in ALLOWED))).toEqual([]);
  });

  it("keeps every allowlist entry live", () => {
    const hits = new Set(findGradeChips(files));
    for (const key of Object.keys(ALLOWED))
      expect(hits.has(key), key).toBe(true);
  });

  it("recognises the idiom it exists to refuse", () => {
    expect(
      findGradeChips([
        {
          path: "components/a.tsx",
          source:
            'const C = { high: "bg-success/15 text-success" }; <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium bg-info/15 text-info")} />',
        },
        {
          path: "components/b.tsx",
          source:
            '<span className="bg-muted rounded-full px-2 py-0.5 text-xs" />',
        },
      ]),
    ).toEqual(["components/a.tsx"]);
  });

  it("is used where the copies were", () => {
    const users = files.filter((f) => f.source.includes("<ScorePill"));
    expect(users.length).toBeGreaterThanOrEqual(8);
  });
});
