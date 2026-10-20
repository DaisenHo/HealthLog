/**
 * Structural guard: a provider client walks a paged collection through
 * `walkPages` (`src/lib/integrations/page-walk.ts`), never a loop of its own.
 *
 * Each hand-rolled loop ended at its page ceiling by returning what it had,
 * silently, and the backfill around it stamped the history complete. A
 * `while (pages < MAX)`, a `pageCount > N` break or a `do … while (next &&
 * pageCount < max)` in a provider directory is that class coming back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const LIB = join(process.cwd(), "src", "lib");
const PROVIDER_DIRS = [
  "dawarich",
  "fitbit",
  "google-health",
  "nightscout",
  "oura",
  "polar",
  "strava",
  "whoop",
  "withings",
];
/**
 * Loops still counting pages on their own, with the reason. Each is bounded
 * and reports nothing at its bound; each moves to `walkPages` with the next
 * change to its file.
 */
const PENDING: Readonly<Record<string, string>> = {
  "google-health/client.ts":
    "progress-bounded walk (backfill-bounds.ts); moves with the next Google Health change",
  "strava/sync.ts":
    "activity pages per sync; moves with the next Strava change",
};

/** A page counter compared against a bound, in any of the shapes used. */
const PAGE_LOOP =
  /\b(?:pages?|pageCount|pagesRead|page)\s*(?:<|<=|>|>=)\s*(?:[A-Z_][A-Z0-9_]*|maxPages|\d+)\b/;

function strip(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("provider clients walk pages through walkPages", () => {
  const files = walkSourceFiles(LIB, { floor: 1000 }).filter(
    (f) =>
      PROVIDER_DIRS.some((d) => f.startsWith(`${d}/`)) &&
      !f.includes("__tests__") &&
      !f.endsWith(".test.ts"),
  );
  const offending = (f: string) =>
    PAGE_LOOP.test(strip(readFileSync(join(LIB, f), "utf8")));

  it("walks the provider directories", () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
  });

  it("finds no page loop of their own outside the pending list", () => {
    expect(files.filter((f) => !(f in PENDING) && offending(f))).toEqual([]);
  });

  it("keeps the pending list honest", () => {
    expect(Object.keys(PENDING).filter((f) => !offending(f))).toEqual([]);
  });

  it("catches the shapes the loops used", () => {
    for (const planted of [
      "while (pages < WORKOUT_MAX_PAGES) {",
      "if (pageCount > 1000) break;",
      "} while (nextToken && pageCount < maxPages);",
    ]) {
      expect(PAGE_LOOP.test(planted), planted).toBe(true);
    }
    expect(PAGE_LOOP.test("const walk = await walkPages(label, 12, f);")).toBe(
      false,
    );
  });
});
