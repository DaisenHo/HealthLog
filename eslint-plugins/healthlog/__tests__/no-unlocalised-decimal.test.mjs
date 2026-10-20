/**
 * Unit tests for the `healthlog/no-unlocalised-decimal` rule — a displayed
 * number goes through the app's formatters. Covers the four flagged idioms,
 * the rounding round-trip that stays legal, the browser time zone lookup, the
 * directive contract, and the scope gating.
 */

import { describe, expect, it } from "vitest";
import { Linter, RuleTester } from "eslint";
import rule from "../no-unlocalised-decimal.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2023,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const APP_FILE = "/repo/src/components/insights/example.tsx";
const PAGE_FILE = "/repo/src/app/(app)/pulse/page.tsx";

ruleTester.run("no-unlocalised-decimal", rule, {
  valid: [
    // The formatter is the sanctioned path.
    { code: "const s = fmt.number(value, 1);", filename: APP_FILE },
    // Rounding, not display: the result is a number again.
    { code: "const n = Number(value.toFixed(2));", filename: APP_FILE },
    { code: "const n = parseFloat(value.toFixed(2));", filename: APP_FILE },
    {
      code: "const n = Number.parseFloat(value.toFixed(2));",
      filename: APP_FILE,
    },
    { code: "const n = +value.toFixed(2);", filename: APP_FILE },
    // A locale is passed.
    { code: 'const s = n.toLocaleString("de-DE");', filename: APP_FILE },
    {
      code: "const s = d.toLocaleDateString(locale, opts);",
      filename: APP_FILE,
    },
    { code: "const f = new Intl.NumberFormat(locale);", filename: APP_FILE },
    // The browser time zone lookup formats nothing.
    {
      code: "const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;",
      filename: APP_FILE,
    },
    // Integer arithmetic in text is fine.
    { code: "const s = `${Math.round(a / b)} h`;", filename: APP_FILE },
    { code: "const s = String(Math.round(a / b));", filename: APP_FILE },
    // A tagged template is not text.
    { code: "const q = sql`${a / b}`;", filename: APP_FILE },
    // Wire formats under src/app/api are not display.
    {
      code: "const s = value.toFixed(2);",
      filename: "/repo/src/app/api/export/route.ts",
    },
    // Outside the source roots and in tests the rule is silent.
    { code: "const s = value.toFixed(2);", filename: "/repo/scripts/x.ts" },
    {
      code: "const s = value.toFixed(2);",
      filename: "/repo/src/lib/__tests__/x.test.ts",
    },
    {
      code: "const s = value.toFixed(2);",
      filename: "/repo/src/components/__tests__/x.test.tsx",
    },
  ],
  invalid: [
    {
      code: "const s = value.toFixed(1);",
      filename: APP_FILE,
      errors: [{ messageId: "fixed", data: { method: "toFixed" } }],
    },
    // A sentence built on the server for a person: the weekday correlation
    // printed "0.8 kg" in a German sentence from src/lib.
    {
      code: 'const delta = Math.abs(a - b).toFixed(1); t("x", { delta });',
      filename: "/repo/src/lib/insights/correlations.ts",
      errors: [{ messageId: "fixed" }],
    },
    {
      code: "const s = value.toFixed(1);",
      filename: "/repo/src/hooks/use-x.ts",
      errors: [{ messageId: "fixed" }],
    },
    {
      code: "const s = `${value.toFixed(1)} kg`;",
      filename: PAGE_FILE,
      errors: [{ messageId: "fixed" }],
    },
    {
      code: "const s = value.toPrecision(3);",
      filename: APP_FILE,
      errors: [{ messageId: "fixed", data: { method: "toPrecision" } }],
    },
    // Number() around something else does not launder the call.
    {
      code: "const s = String(Number(a) + value.toFixed(1));",
      filename: APP_FILE,
      errors: [{ messageId: "fixed" }],
    },
    {
      code: "<span>{total.toLocaleString()}</span>",
      filename: APP_FILE,
      errors: [{ messageId: "localeless" }],
    },
    {
      code: "const s = d.toLocaleDateString(undefined, { day: 'numeric' });",
      filename: APP_FILE,
      errors: [{ messageId: "localeless" }],
    },
    {
      code: "const s = d.toLocaleTimeString();",
      filename: APP_FILE,
      errors: [{ messageId: "localeless" }],
    },
    {
      code: "const f = new Intl.NumberFormat();",
      filename: APP_FILE,
      errors: [{ messageId: "intlLocaleless" }],
    },
    {
      code: "const f = new Intl.DateTimeFormat(undefined, { hour: '2-digit' });",
      filename: APP_FILE,
      errors: [{ messageId: "intlLocaleless" }],
    },
    {
      code: "const s = String(Math.round(v * 10) / 10);",
      filename: APP_FILE,
      errors: [{ messageId: "division" }],
    },
    {
      code: "const s = `${total / count} per day`;",
      filename: APP_FILE,
      errors: [{ messageId: "division" }],
    },
  ],
});

/**
 * Directives resolve against the rule's registered name, which RuleTester
 * does not use, so they run through a Linter with the plugin registered as
 * `healthlog` — the way the flat config loads it.
 */
describe("no-unlocalised-decimal disable directives", () => {
  const linter = new Linter({ configType: "flat" });
  const config = [
    {
      files: ["**/*.tsx"],
      plugins: { healthlog: { rules: { "no-unlocalised-decimal": rule } } },
      rules: { "healthlog/no-unlocalised-decimal": "error" },
      languageOptions: {
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
  ];
  const lint = (code) =>
    linter
      .verify(code, config, { filename: "src/components/charts/x.tsx" })
      .map((m) => m.messageId ?? m.message);

  it("flags the site without a directive", () => {
    expect(lint("const d = `${x.toFixed(1)}`;")).toEqual(["fixed"]);
  });

  it("accepts a next-line directive that gives a reason", () => {
    expect(
      lint(
        "// eslint-disable-next-line healthlog/no-unlocalised-decimal -- SVG coordinates, not text\nconst d = `${x.toFixed(1)}`;",
      ),
    ).toEqual([]);
  });

  it("refuses a directive without a reason", () => {
    expect(
      lint(
        "// eslint-disable-next-line healthlog/no-unlocalised-decimal\nconst d = x.toFixed(1);",
      ),
    ).toEqual(["missingReason"]);
  });

  it("refuses a whole-file disable, which would hide the next site too", () => {
    expect(
      lint(
        "const a = 1;\n/* eslint-disable healthlog/no-unlocalised-decimal -- SVG coordinates, not text */\nconst d = x.toFixed(1);",
      ),
    ).toEqual(["nextLineOnly"]);
  });
});
