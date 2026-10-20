/**
 * Structural guard: the latest reading per measurement type has two readers,
 * and the summaries slice one cache cell.
 *
 * Postgres 16 has no skip scan, so `DISTINCT ON (type)` over `measurements`
 * sorts every row it can see to keep one per type. Five copies of that shape
 * sat in the dashboard, analytics, insights and targets reads; each one now
 * goes through `readLatestCanonical` (the ladder-canonical reading of the
 * latest day) or `readLatestEver` (the latest raw reading), both driven from
 * the type list with one index probe per type.
 *
 * The summaries slice was computed inside three cells (the tile-strip route,
 * the thick analytics body, the dashboard snapshot). `readSummariesSlice` is
 * the one cell; `computeSummariesSlice` is its builder and is called nowhere
 * else in production code.
 *
 * Comments are stripped before matching, and the planted cases prove each
 * matcher finds what it claims to.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { stripComments, walkSourceFiles } from "./helpers/source-files";

/** The shared comment strip, plus SQL line comments inside template strings. */
function stripCode(text: string): string {
  return stripComments(text).replace(/^\s*--.*$/gm, "");
}

const SRC = join(process.cwd(), "src");

/** `DISTINCT ON (type)` or `DISTINCT ON (m."type")`, the type alone. */
const LATEST_PER_TYPE = /DISTINCT\s+ON\s*\(\s*(?:\w+\s*\.\s*)?"?type"?\s*\)/i;

const SLICE_BUILDER_CALL = /\bcomputeSummariesSlice\s*\(/;

function productionFiles(): string[] {
  return walkSourceFiles(SRC, { floor: 3000 }).filter(
    (file) =>
      !file.startsWith("generated/") &&
      !file.includes("__tests__/") &&
      !/\.test\.tsx?$/.test(file),
  );
}

describe("latest-per-type reads", () => {
  it("the matchers find their shapes", () => {
    expect(
      LATEST_PER_TYPE.test(`SELECT DISTINCT ON (m."type") m."value"`),
    ).toBe(true);
    expect(LATEST_PER_TYPE.test(`SELECT DISTINCT ON ("type") value`)).toBe(
      true,
    );
    expect(
      LATEST_PER_TYPE.test(`SELECT DISTINCT ON ("type", "bucket_start")`),
    ).toBe(false);
    expect(
      SLICE_BUILDER_CALL.test(`await computeSummariesSlice(user.id)`),
    ).toBe(true);
  });

  it("no production read keeps one row per type with DISTINCT ON", () => {
    const offenders = productionFiles().filter((file) =>
      LATEST_PER_TYPE.test(stripCode(readFileSync(join(SRC, file), "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("the summaries slice is built only behind its cache cell", () => {
    const callers = productionFiles().filter((file) =>
      SLICE_BUILDER_CALL.test(stripCode(readFileSync(join(SRC, file), "utf8"))),
    );
    expect(callers).toEqual(["lib/analytics/summaries-slice.ts"]);
  });
});
