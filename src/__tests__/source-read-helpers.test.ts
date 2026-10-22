/**
 * `readSource` and `readSourceFolder`: the reads a path-pinned guard goes
 * through, so a split file fails the guard instead of leaving it green.
 */
import { describe, expect, it } from "vitest";

import { readSource, readSourceFolder } from "./helpers/source-files";

const HERE = "src/__tests__/helpers/source-files.ts";

describe("readSource", () => {
  it("returns the text when every anchor is present", () => {
    const text = readSource(HERE, [
      "export function readSource(",
      /export function walkSourceFiles\(/,
    ]);
    expect(text.length).toBeGreaterThan(1000);
  });

  it("throws on a file that does not exist", () => {
    expect(() => readSource("src/lib/does-not-exist.ts", "anything")).toThrow(
      /does not exist/,
    );
  });

  it("throws when an anchor no longer matches", () => {
    expect(() =>
      readSource(HERE, ["export function readSource(", "noSuchAnchorHere"]),
    ).toThrow(/no longer contains noSuchAnchorHere/);
    expect(() => readSource(HERE, /export function neverDeclared\(/)).toThrow(
      /no longer contains/,
    );
  });

  it("refuses a read without an anchor", () => {
    expect(() => readSource(HERE, [])).toThrow(/at least one anchor/);
  });
});

describe("readSourceFolder", () => {
  it("returns the files with their text, above the floor", () => {
    const files = readSourceFolder("src/__tests__/helpers", { floor: 5 });
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files.map(([rel]) => rel)).toContain("source-files.ts");
  });

  it("throws when the folder holds fewer files than the floor", () => {
    expect(() =>
      readSourceFolder("src/__tests__/helpers", {
        floor: 1,
        include: (rel) => rel === "nothing-matches.ts",
      }),
    ).toThrow(/below the stated floor/);
  });
});
