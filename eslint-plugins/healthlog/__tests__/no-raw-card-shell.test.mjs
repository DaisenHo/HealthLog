/**
 * Unit tests for the `healthlog/no-raw-card-shell` rule — a card surface is a
 * <Card> or a shell primitive. Covers the three-part match, the translucent
 * and inner-tile radii that stay legal, cn()/template strings, the allow
 * option, and the scope gating.
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../no-raw-card-shell.js";

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

ruleTester.run("no-raw-card-shell", rule, {
  valid: [
    { code: '<Card className="gap-3" />', filename: APP_FILE },
    // An inner tile: another radius.
    {
      code: '<div className="bg-card border-border rounded-lg border p-3" />',
      filename: APP_FILE,
    },
    // The translucent hero glass and inner washes are not the card colour.
    {
      code: '<div className="bg-card/65 rounded-xl border p-4 backdrop-blur-sm" />',
      filename: APP_FILE,
    },
    // No border: not a shell.
    { code: '<div className="bg-card rounded-xl p-4" />', filename: APP_FILE },
    // The primitives under src/components/ui own the shell.
    {
      code: '<div className="bg-card border rounded-xl p-4" />',
      filename: "/repo/src/components/ui/trend-tile.tsx",
    },
    // An allowed file.
    {
      code: '<div className="bg-card border rounded-xl p-4" />',
      filename: "/repo/src/components/charts/health-chart.tsx",
      options: [{ allow: ["src/components/charts/health-chart.tsx"] }],
    },
    // Outside the UI roots and in tests.
    {
      code: 'const c = "bg-card border rounded-xl";',
      filename: "/repo/src/lib/x.ts",
    },
    {
      code: '<div className="bg-card border rounded-xl" />',
      filename: "/repo/src/components/__tests__/x.test.tsx",
    },
  ],
  invalid: [
    {
      code: '<div className="bg-card border-border rounded-xl border p-4 md:p-6" />',
      filename: APP_FILE,
      errors: [{ messageId: "rawShell" }],
    },
    {
      code: 'cn("bg-card hover:bg-accent/40 block rounded-xl border p-4", className)',
      filename: "/repo/src/app/insights/pulse/page.tsx",
      errors: [{ messageId: "rawShell" }],
    },
    {
      code: "const c = `bg-card rounded-xl border-dashed ${x}`;",
      filename: APP_FILE,
      errors: [{ messageId: "rawShell" }],
    },
    // An allow entry for another file does not cover this one.
    {
      code: '<div className="bg-card border rounded-xl" />',
      filename: APP_FILE,
      options: [{ allow: ["src/components/charts/health-chart.tsx"] }],
      errors: [{ messageId: "rawShell" }],
    },
  ],
});
