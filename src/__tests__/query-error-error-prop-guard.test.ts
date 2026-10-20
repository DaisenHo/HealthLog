/**
 * Every read-failure primitive is handed the error it reports.
 *
 * `QueryErrorRow` and `QueryErrorCard` decide what a failed read offers from
 * the error itself: nothing (or the surface's refused state) for a 403, a
 * note without a retry for a 429, sign-in for a 401, a retry otherwise. A
 * call site that renders one without the error falls back to "failed" for
 * every status, which is how a refused share showed an error card and a spent
 * budget offered a retry that could only be refused again.
 *
 * The prop is required in the type, so the compiler already catches a missing
 * one. What it cannot catch is a literal that defeats it (`error={null}`,
 * `error={undefined}`), so this guard reads every opening tag under `src/`
 * and refuses both. The matcher is whitespace-tolerant (tags span lines) and
 * the match count is asserted, so a matcher that stops finding the tags fails
 * rather than passing over nothing.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "generated") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, out);
    else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test."))
      out.push(path);
  }
  return out;
}

/** The opening tag's attribute text, from the name to its closing `>`. */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  const open = /<(QueryErrorRow|QueryErrorCard)(?=[\s/>])/g;
  for (let m = open.exec(source); m; m = open.exec(source)) {
    let depth = 0;
    let i = m.index + m[0].length;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (ch === ">" && depth === 0) break;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

/** Comments mention the primitives by name (`<QueryErrorCard>`); skip them. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const sites = walk(SRC).flatMap((file) =>
  openingTags(stripComments(readFileSync(file, "utf8"))).map((tag) => ({
    file: relative(SRC, file),
    tag,
  })),
);

describe("read-failure primitives carry their error", () => {
  it("finds the call sites it guards", () => {
    // About 120 at the time of writing. A drop to a handful means the
    // matcher broke, not that the sites went away.
    expect(sites.length).toBeGreaterThan(100);
  });

  it("passes the query's error at every site", () => {
    const offenders = sites
      .filter(
        ({ tag }) =>
          !/\serror=\{/.test(tag) ||
          /\serror=\{\s*(null|undefined)\s*\}/.test(tag),
      )
      .map(({ file, tag }) => `${file}: ${tag.split("\n")[0]}`);
    expect(offenders).toEqual([]);
  });
});
