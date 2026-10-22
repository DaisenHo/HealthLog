/**
 * The image optimizer stays off while nothing uses it.
 *
 * `next.config.ts` sets `images.unoptimized`, which makes Next answer
 * `/_next/image` with 404 before it reads a parameter, so the route that
 * fetches, decodes and re-encodes images is not reachable at all. Two ways
 * to undo that quietly, and this pins both:
 *
 *   1. A component imports `next/image` (or `next/legacy/image`) while the
 *      optimizer is off. It would render, unoptimized, and the next person
 *      to notice the missing optimization would switch the optimizer back on
 *      without the review this flag deserves. Using `next/image` means
 *      revisiting this decision, so the import fails here first.
 *   2. The optimizer comes back on with `dangerouslyAllowSVG`. An SVG is a
 *      document, not a picture, and the framework's own advisories have been
 *      about exactly that input. Re-enabling the optimizer is allowed; doing
 *      it with SVG input allowed is not.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  requireFloor,
  stripComments,
  walkSourceFiles,
} from "./helpers/source-files";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

type ImagesConfig = {
  unoptimized?: boolean;
  dangerouslyAllowSVG?: boolean;
};

async function imagesConfig(): Promise<ImagesConfig> {
  const mod = (await import("../../next.config")) as {
    default: { images?: ImagesConfig };
  };
  return mod.default.images ?? {};
}

/** Matches any import of `specifier` (static, dynamic, `require`, re-export). */
function importOf(specifier: string): RegExp {
  const escaped = specifier.replace(/[/]/g, "\\/");
  return new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*|^\\s*import\\s+)["']${escaped}["']`,
    "m",
  );
}

const NEXT_IMAGE_IMPORT = importOf("next/(?:legacy/)?image");

/** Every non-generated, non-test source file under `src/` matching `re`. */
function importers(re: RegExp): string[] {
  return walkSourceFiles(SRC, { floor: 3000 })
    .filter((rel) => !rel.startsWith("generated/"))
    .filter((rel) => !rel.includes("__tests__/"))
    .filter((rel) =>
      re.test(stripComments(readFileSync(join(SRC, rel), "utf8"))),
    );
}

describe("next/image optimizer", () => {
  it("the import matcher recognises every form of the import", () => {
    // The sweep below passes when it matches nothing, so the matcher has to
    // be shown to match before an empty result means anything.
    for (const line of [
      'import Image from "next/image";',
      "import Image from 'next/legacy/image';",
      'const Image = await import("next/image");',
      'const Image = require("next/image");',
      'import "next/image";',
      'export { default } from "next/image";',
    ]) {
      expect(NEXT_IMAGE_IMPORT.test(line), line).toBe(true);
    }
    for (const line of [
      "// `next/image` is wrong here",
      'const path = "/_next/image?url=x";',
      'import { foo } from "next/image-extra";',
    ]) {
      expect(NEXT_IMAGE_IMPORT.test(stripComments(line)), line).toBe(false);
    }
  });

  it("the same sweep finds the imports of a sibling module", () => {
    // An empty result for `next/image` is only worth something if the walk,
    // the comment stripping and the matcher together do find real imports.
    // `next/link` is imported the same way all over the tree.
    requireFloor("next/link importers", importers(importOf("next/link")), 100);
  });

  it("is off, and then nothing imports next/image", async () => {
    const images = await imagesConfig();
    if (images.unoptimized !== true) return;
    expect(importers(NEXT_IMAGE_IMPORT)).toEqual([]);
  });

  it("is never on with SVG input allowed", async () => {
    const images = await imagesConfig();
    if (images.unoptimized === true) return;
    expect(images.dangerouslyAllowSVG ?? false).toBe(false);
  });

  it("is off today", async () => {
    // The two cases above each skip on the other branch. This pins which
    // branch the tree is on, so flipping it is a visible change to this
    // file and not a silent switch between the two.
    expect((await imagesConfig()).unoptimized).toBe(true);
  });
});
