/**
 * Structural guard: a provider client or a file importer rounds an imported
 * value through `importValue` (`src/lib/integrations/import-value.ts`) and
 * nothing else.
 *
 * Each client used to keep its own `parseFloat(n.toFixed(2))`. Five copies
 * of one rule drift apart, and `toFixed` mis-rounds halves on the double
 * below the decimal. The Health Connect importer had the other spelling,
 * `Math.round(x * 1000) / 1000`, in three places and stored its unit
 * factors' noise unrounded everywhere else. A `toFixed`, a private `round2`
 * or a scaled `Math.round` in these directories is the class coming back.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const LIB = join(process.cwd(), "src", "lib");
const PROVIDER_DIRS = [
  "apple-health",
  "dawarich",
  "fitbit",
  "google-health",
  "nightscout",
  "oura",
  "polar",
  "strava",
  "whoop",
  "withings",
  "import",
];
const ROUNDING =
  /\.toFixed\s*\(|\b(?:function|const|let)\s+round2\b|Math\.round\s*\([^;]*\*\s*(10+)\s*\)\s*\/\s*\1\b/;

/** Files that round for display, not on the way in, and say so. */
const ALLOWED: Record<string, string> = {
  "dawarich/movement.ts":
    "Formats a stored distance to one decimal in the account's unit for the day view; nothing is stored.",
  "import/unzip-export-xml.ts":
    "Prints a compression ratio into an error message.",
};

function strip(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("provider clients round through importValue", () => {
  const files = walkSourceFiles(LIB, { floor: 1000 }).filter(
    (f) =>
      PROVIDER_DIRS.some((d) => f.startsWith(`${d}/`)) &&
      !f.includes("__tests__") &&
      !f.endsWith(".test.ts"),
  );

  it("walks the provider directories", () => {
    expect(files.length).toBeGreaterThanOrEqual(60);
  });

  it("finds no rounding of their own", () => {
    const offenders = files.filter(
      (f) =>
        !(f in ALLOWED) &&
        ROUNDING.test(strip(readFileSync(join(LIB, f), "utf8"))),
    );
    expect(offenders).toEqual([]);
  });

  it("catches a planted copy", () => {
    expect(ROUNDING.test("const v = parseFloat(n.toFixed(2));")).toBe(true);
    expect(ROUNDING.test("function round2(n: number) {}")).toBe(true);
    expect(ROUNDING.test("const round2 = (n: number) => n;")).toBe(true);
    expect(ROUNDING.test("const a = Math.round(e.amount * 1000) / 1000;")).toBe(
      true,
    );
    expect(ROUNDING.test("value: Math.round(mean * 10) / 10,")).toBe(true);
    expect(ROUNDING.test("value: importValue(n)")).toBe(false);
    expect(ROUNDING.test("Math.round((end - start) / 1000)")).toBe(false);
    expect(ROUNDING.test("Math.round(mmol * MGDL_PER_MMOL)")).toBe(false);
  });
});
