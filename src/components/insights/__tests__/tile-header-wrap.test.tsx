import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Heart } from "lucide-react";

import {
  stripComments,
  walkSourceFiles,
} from "@/__tests__/helpers/source-files";

import { TileHeader } from "../tile-header";

/**
 * A tile title names the figure under it, so it wraps and never truncates.
 * Seven callers passed `titleClassName="truncate"` and German compounds
 * ("Erholungs-Score", "Herzfrequenzvariabilität") ended in an ellipsis on a
 * narrow tile. The class override is gone; the primitive owns the wrap.
 */
function titleClasses(html: string): string {
  const match = html.match(
    /data-slot="card-title"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="card-title"/,
  );
  expect(match, "card title not rendered").not.toBeNull();
  return match![1] ?? match![2];
}

describe("<TileHeader> title", () => {
  it.each([
    ["default", undefined],
    ["h2 heading", "h2" as const],
  ])("wraps at a syllable as a %s", (_name, titleAs) => {
    const html = renderToStaticMarkup(
      <TileHeader
        icon={Heart}
        title="Herzfrequenzvariabilität"
        titleAs={titleAs}
      />,
    );
    const classes = titleClasses(html);
    expect(classes).toContain("min-w-0");
    expect(classes).toContain("break-words");
    expect(classes).toContain("hyphens-auto");
    expect(classes).not.toContain("truncate");
    expect(classes).not.toContain("whitespace-nowrap");
  });

  it("keeps the compact variant on the same contract", () => {
    const html = renderToStaticMarkup(
      <TileHeader size="sm" icon={Heart} title="Körperfettverteilung" />,
    );
    const classes = titleClasses(html);
    expect(classes).toContain("text-sm");
    expect(classes).toContain("hyphens-auto");
    expect(classes).not.toContain("truncate");
  });
});

describe("no card title is cut", () => {
  // A `CardTitle` or a tile `TileHeader` that truncates hides the one word
  // that says what the card is. `truncate` stays legal on rows and meta
  // lines that carry their full text in `title`; never on a card title.
  const SRC = join(process.cwd(), "src");
  const TITLE_TAG = /<(CardTitle|TileHeader)\b[^>]*?>/g;
  const CUT = /\b(truncate|whitespace-nowrap|titleClassName)\b/;

  const offenders: string[] = [];
  let tags = 0;
  for (const root of ["components", "app"]) {
    for (const rel of walkSourceFiles(join(SRC, root), {
      floor: root === "app" ? 100 : 500,
      extensions: [".tsx"],
    })) {
      if (rel.includes("__tests__/")) continue;
      const source = stripComments(readFileSync(join(SRC, root, rel), "utf8"));
      for (const match of source.matchAll(TITLE_TAG)) {
        tags += 1;
        if (CUT.test(match[0])) offenders.push(`${root}/${rel}: ${match[1]}`);
      }
    }
  }

  it("reads the title tags in the tree", () => {
    expect(tags).toBeGreaterThan(60);
  });

  it("finds none that cut", () => {
    expect(offenders).toEqual([]);
  });

  it("would catch one", () => {
    const planted = `<CardTitle className="min-w-0 truncate">x</CardTitle>`;
    const found = [...planted.matchAll(TITLE_TAG)].filter((m) =>
      CUT.test(m[0]),
    );
    expect(found).toHaveLength(1);
  });
});
