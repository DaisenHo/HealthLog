/**
 * The build fetches no font from the network.
 *
 * `next/font/google` downloads its files from fonts.gstatic.com while the app
 * builds, and that download failing is what broke image builds. Inter is
 * committed under `src/app/fonts/inter/` instead, under its licence, and
 * declared through `next/font/local`. This guard keeps it that way: no source
 * file imports the Google loader, every file the local declarations name is
 * in the tree, and each subset carries the four weights the app was built
 * with.
 *
 * Mutation check: importing `Inter` from the Google loader anywhere under
 * `src/` fails the first case; deleting a `.woff2` or dropping a weight from a
 * subset fails the second.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { readSource, readSourceFolder } from "./helpers/source-files";

const ROOT = process.cwd();
const FONT_MODULE = "src/app/fonts/inter.ts";

describe("self-hosted fonts", () => {
  it("imports no font loader that downloads at build time", () => {
    const importing = readSourceFolder("src", {
      floor: 3000,
      include: (rel) => !rel.startsWith("generated/"),
      extensions: [".ts", ".tsx", ".mts", ".js", ".mjs"],
    })
      .filter(([, text]) => /from\s+["']next\/font\/google["']/.test(text))
      .map(([rel]) => rel);
    expect(importing).toEqual([]);
  });

  it("ships every file the declarations name, with its licence and four weights", () => {
    const source = readSource(FONT_MODULE, ["next/font/local", "localFont("]);
    const entries = [
      ...source.matchAll(/path:\s*"([^"]+)",\s*weight:\s*"(\d+)"/g),
    ].map(([, path, weight]) => ({ path: path!, weight: weight! }));
    expect(entries.length).toBe(28);

    const byFile = new Map<string, string[]>();
    for (const { path, weight } of entries) {
      byFile.set(path, [...(byFile.get(path) ?? []), weight]);
    }
    expect(byFile.size).toBe(7);
    for (const [path, weights] of byFile) {
      expect(existsSync(join(ROOT, dirname(FONT_MODULE), path)), path).toBe(
        true,
      );
      expect(weights, path).toEqual(["400", "500", "600", "700"]);
    }
    expect(existsSync(join(ROOT, "src/app/fonts/inter/OFL.txt"))).toBe(true);
  });
});
