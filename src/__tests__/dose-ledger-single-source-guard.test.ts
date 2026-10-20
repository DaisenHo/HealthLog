/**
 * Structural guard: medication compliance is tallied from one ledger.
 *
 * The cadence chips carried a private copy of the ledger build that
 * `lib/analytics/compliance/ledger.ts` owns, minus the pause eras and the
 * courses, so `/api/medications/[id]/cadence` could report 77 % for a month
 * the detail page called 100 %. The chips now tally the shared ledger.
 *
 * `reconstructDoseHistory` is the step that turns minted bands and intakes
 * into dose rows. The set of files that call it is frozen: the ledger, the
 * cadence timeline (the chart and the streaks) and the dose-history view. A
 * new caller is a new ledger and has to be added here, next to a reason.
 * Comments are stripped first; the count floor proves the matcher reads.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");

const CALLERS: Record<string, string> = {
  "lib/analytics/compliance/ledger.ts":
    "The compliance ledger every rate and the chips tally.",
  "lib/medications/scheduling/cadence.ts":
    "The cadence timeline the chart draws and the streaks walk.",
  "app/api/medications/[id]/dose-history/route.ts":
    "The dose-history view, row by row over the same bands.",
};

const CALL = /\breconstructDoseHistory\s*\(/;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("one compliance ledger", () => {
  it("the dose rows are built only where this file says", () => {
    const callers = walkSourceFiles(SRC, { floor: 3000 })
      .filter(
        (file) =>
          !file.startsWith("generated/") &&
          !file.includes("__tests__/") &&
          !/\.test\.tsx?$/.test(file) &&
          file !== "lib/medications/scheduling/dose-history.ts",
      )
      .filter((file) =>
        CALL.test(stripComments(readFileSync(join(SRC, file), "utf8"))),
      )
      .sort();
    expect(callers.length).toBeGreaterThanOrEqual(3);
    expect(callers).toEqual(Object.keys(CALLERS).sort());
  });
});
