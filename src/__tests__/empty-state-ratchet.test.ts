/**
 * An honest no-data state goes through `EmptyState` (or `ChartEmptyState` on
 * a chart body), UI standards §6.
 *
 * Seventy-five surfaces said "nothing here yet" in a hand-written muted
 * paragraph, in five sizes and three alignments, some centred in a padded
 * box, some a bare line under the header. This is a ratchet, not a ban: the
 * hand-written copies that remain are counted, the ceiling below may only go
 * down, and a new copy fails the run. The ones that stay are not list or
 * section empty states but a field that has no value ("not recorded" in a
 * profile row), where a centred block would be the wrong shape.
 *
 * Matched: a `<p>`, `<div>` or `<span>` whose class list carries
 * `text-muted-foreground` and whose only child is `{t("<key>")}` with a last
 * key segment that names an empty state (`empty`, `none`, `noData`,
 * `noResults`, `notRecorded`, …; a `…Hint` key is a hint, not a state).
 *
 * Not matched (stated, not hidden): a message assembled from several nodes,
 * a key built at runtime, a state without the muted colour. The guard holds
 * the idiom, not every way to say nothing.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(__dirname, "..");

/**
 * The hand-written empty states that remain. Lower it when a site moves to
 * `EmptyState`; never raise it.
 */
const CEILING = 13;

const ELEMENT_RE =
  /<(p|div|span)\b([^>]*?)>\s*\{t\(\s*"([a-zA-Z0-9_.]+)"[^)]*\)\}\s*<\/\1>/g;
const EMPTY_KEY_RE =
  /(?:^|\.)[A-Za-z0-9]*?(?:empty|Empty|none|None|noData|NoData|noResults|NoResults|notRecorded|NotRecorded|noSeries|NoSeries|noReminder|NoReminder|noMedications|noSymptoms|noTimes)[A-Za-z0-9]*$/;

function findHandWrittenEmptyStates(
  files: { path: string; source: string }[],
): string[] {
  const hits: string[] = [];
  for (const { path, source } of files) {
    for (const match of source.matchAll(ELEMENT_RE)) {
      const [, , attrs, key] = match;
      if (!attrs.includes("text-muted-foreground")) continue;
      if (!EMPTY_KEY_RE.test(key) || key.endsWith("Hint")) continue;
      hits.push(`${path}: ${key}`);
    }
  }
  return hits;
}

describe("empty states go through EmptyState (ratchet)", () => {
  const files = walkSourceFiles(SRC, { floor: 2500 })
    .filter(
      (p) =>
        p.endsWith(".tsx") &&
        (p.startsWith("components/") || p.startsWith("app/")) &&
        !p.startsWith("components/ui/") &&
        !p.includes("__tests__/"),
    )
    .map((path) => ({ path, source: readFileSync(join(SRC, path), "utf8") }));

  it("walks the UI tree", () => {
    expect(files.length).toBeGreaterThan(800);
  });

  it("adds no hand-written empty state", () => {
    const hits = findHandWrittenEmptyStates(files);
    expect(
      hits.length,
      `${hits.length} hand-written empty states, ceiling ${CEILING}. Render the new one through <EmptyState variant="plain" size="compact"> (or ChartEmptyState on a chart body).\n${hits.join("\n")}`,
    ).toBeLessThanOrEqual(CEILING);
  });

  it("has its ceiling lowered when a site moves over", () => {
    const hits = findHandWrittenEmptyStates(files);
    expect(
      hits.length,
      `Only ${hits.length} hand-written empty states remain: lower CEILING to ${hits.length}.`,
    ).toBe(CEILING);
  });

  it("recognises the idiom it exists to count", () => {
    expect(
      findHandWrittenEmptyStates([
        {
          path: "components/a.tsx",
          source:
            '<p className="text-muted-foreground text-sm">{t("admin.aiQuality.empty")}</p>',
        },
        {
          path: "components/b.tsx",
          source:
            '<p className="text-muted-foreground text-xs">{t("cycle.sheet.emptyHint")}</p>',
        },
        {
          path: "components/c.tsx",
          source: '<EmptyState title={t("labs.detail.emptyTitle")} />',
        },
      ]),
    ).toEqual(["components/a.tsx: admin.aiQuality.empty"]);
  });
});
