import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "@/__tests__/helpers/source-files";

/**
 * No raw control byte in a source file, apart from tab, newline and carriage
 * return.
 *
 * A control byte typed into a string literal is invisible in an editor, a
 * diff and a review, renders as nothing or as a box, and survives copy and
 * paste unseen; the same value written as an escape (`"\x01"`) is the same
 * string and can be read. Three such bytes had crept in, one of them in a
 * production join key.
 */
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

describe("source files carry no raw control bytes", () => {
  it("every file under src/ is free of them", () => {
    const src = join(process.cwd(), "src");
    const files = walkSourceFiles(src, {
      floor: 3000,
      extensions: [".ts", ".tsx", ".js", ".mjs", ".css", ".json", ".md"],
    }).filter((file) => !file.startsWith("generated/"));
    const offenders: string[] = [];
    for (const file of files) {
      const lines = readFileSync(join(src, file), "utf8").split("\n");
      lines.forEach((line, i) => {
        if (CONTROL.test(line)) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("recognises a control byte when one is there", () => {
    expect(CONTROL.test("a\u0001b")).toBe(true);
    expect(CONTROL.test("tab\tnewline\ncr\r")).toBe(false);
  });
});
