/**
 * Structural guard: a naive UTC timestamp is read as UTC before it is
 * shifted into a person's zone.
 *
 * `measured_at`, `scheduled_for`, `taken_at` and the other `*_at` instants
 * are `timestamp` columns holding UTC wall-clock time. On that type,
 * `col AT TIME ZONE tz` means "this is local time in tz" and returns the
 * matching instant, so the value moves by the offset in the wrong direction:
 * in Berlin a 23:30 UTC reading lands on the day before instead of the day
 * after. The right form is `(col AT TIME ZONE 'UTC') AT TIME ZONE tz`. The
 * dashboard streak and the medication-compliance backfill both keyed days
 * with the single form, while their comments called it identical to
 * `userDayKey`.
 *
 * The matcher flags a quoted `*_at` or `scheduled_for` column shifted
 * straight into a bound zone (`${...}` or `$N`). A `timestamptz` column
 * (`bucket_start`) is out of its reach by name. Comments are stripped first;
 * the planted cases prove it fires. It is a tripwire, not a proof.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");

const SINGLE_SHIFT =
  /"(?:[a-z_]+_at|scheduled_for)"\s*\)?\s*AT\s+TIME\s+ZONE\s+(?:\$\{|\$\d)/i;

const DOUBLE_SHIFT =
  /AT\s+TIME\s+ZONE\s+'UTC'\s*\)?\s*AT\s+TIME\s+ZONE\s+(?:\$\{|\$\d)/i;

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");
}

describe("naive timestamp zone shifts", () => {
  it("the matcher fires on the single shift and spares the double one", () => {
    expect(
      SINGLE_SHIFT.test(`to_char(m."measured_at" AT TIME ZONE \${tz}, 'D')`),
    ).toBe(true);
    expect(SINGLE_SHIFT.test(`("scheduled_for" AT TIME ZONE $3)`)).toBe(true);
    expect(
      SINGLE_SHIFT.test(
        `("scheduled_for" AT TIME ZONE 'UTC') AT TIME ZONE \${tz}`,
      ),
    ).toBe(false);
    expect(SINGLE_SHIFT.test(`r."bucket_start" AT TIME ZONE \${tz}`)).toBe(
      false,
    );
  });

  it("no production read shifts a naive column once", () => {
    const files = walkSourceFiles(SRC, { floor: 3000 }).filter(
      (file) =>
        !file.startsWith("generated/") &&
        !file.includes("__tests__/") &&
        !/\.test\.tsx?$/.test(file),
    );
    const code = (file: string) =>
      stripComments(readFileSync(join(SRC, file), "utf8"));
    // The reads that shift correctly, so a sweep that reads nothing fails.
    const doubleShifts = files.filter((file) => DOUBLE_SHIFT.test(code(file)));
    expect(doubleShifts.length).toBeGreaterThanOrEqual(5);
    expect(files.filter((file) => SINGLE_SHIFT.test(code(file)))).toEqual([]);
  });
});
