/**
 * Unit tests for the `healthlog/no-planning-tags` rule: a planning-note
 * identifier at the head of a comment line is reported and autofixed; a
 * release version, an issue reference, domain vocabulary, ordinary prose and
 * string contents are left alone.
 */
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import rule from "../no-planning-tags.js";

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

const error = { messageId: "planningTag" };

ruleTester.run("no-planning-tags", rule, {
  valid: [
    // A release version that dates the behaviour may stay.
    "// v1.4.27 — `/about` carries the attribution.\nconst x = 1;",
    "// Since v1.39 every AI decision is one resolution.\nconst x = 1;",
    // Issue references stay, with or without a version.
    "// v1.43 (#1234) — a later start inside the same period.\nconst x = 1;",
    "// v1.43 (iOS #116 item 9) — the age band.\nconst x = 1;",
    "// Issue #281 — the import surface.\nconst x = 1;",
    // Domain vocabulary that looks like a code.
    "// B12 — cobalamin, reported in pmol/L.\nconst x = 1;",
    "// PM2.5 — fine particulate matter.\nconst x = 1;",
    "// UTF-8 — the wire encoding.\nconst x = 1;",
    "// APP13 — Photoshop / IPTC-IIM\nconst x = 1;",
    // Enumerations and prose.
    "// Step 2 — parse the payload.\nconst x = 1;",
    "// Round 2 — the model answers with the tool result.\nconst x = 1;",
    "// OpenAPI route table — one entry per path.\nconst x = 1;",
    "/** 2026-05-12 — only one source reported. */\nconst x = 1;",
    // A label the file's code also uses (a test named `T1 …`).
    '// T1 — no file hand-rolls the locale.\nit("T1 no file hand-rolls the locale", () => {});',
    // A tag inside a string is not a comment.
    'const title = "v1.4.20 B3 — /insights mounts TrendsRow";',
    // Mid-sentence references are out of the rule's reach by design.
    "// The card replaced the one from W4 — see the layout.\nconst x = 1;",
  ],
  invalid: [
    {
      code: "// v1.4.34 IW-B — the provider now mounts here.\nconst x = 1;",
      output: "// v1.4.34 — the provider now mounts here.\nconst x = 1;",
      errors: [error],
    },
    {
      code: "/**\n * v1.4.40 W-PRIVACY (SB-3) — bilingual public privacy policy.\n */\nconst x = 1;",
      output:
        "/**\n * v1.4.40 — bilingual public privacy policy.\n */\nconst x = 1;",
      errors: [error],
    },
    {
      // The issue reference survives the fix.
      code: "// v1.30.1 W9 (#812) — pull-to-refresh parity.\nconst x = 1;",
      output: "// v1.30.1 (#812) — pull-to-refresh parity.\nconst x = 1;",
      errors: [error],
    },
    {
      // A colon separator after a version.
      code: "// v1.4.15 phase-C5: upgrade to the EmptyState primitive.\nconst x = 1;",
      output: "// v1.4.15: upgrade to the EmptyState primitive.\nconst x = 1;",
      errors: [error],
    },
    {
      // Without a version the tag goes and the sentence starts upper-case.
      code: "// C4 — the replaced fields; the note is never quoted.\nconst x = 1;",
      output: "// The replaced fields; the note is never quoted.\nconst x = 1;",
      errors: [error],
    },
    {
      code: "/** RECON1 (D5-5) — the snapshot driver block. */\nconst x = 1;",
      output: "/** The snapshot driver block. */\nconst x = 1;",
      errors: [error],
    },
    {
      code: "// Phase 4 — MCP prompts.\nconst x = 1;",
      output: "// MCP prompts.\nconst x = 1;",
      errors: [error],
    },
    {
      code: "// 2026-07-17 UX/IA audit (M6) — which sidebar group this renders under.\nconst x = 1;",
      output: "// Which sidebar group this renders under.\nconst x = 1;",
      errors: [error],
    },
    {
      // JSX comment.
      code: "const el = <div>{/* v1.4.33 IW9 — aria-label for the bar. */}</div>;",
      output:
        "const el = <div>{/* v1.4.33 — aria-label for the bar. */}</div>;",
      errors: [error],
    },
    {
      // Two tagged lines in one block, each reported.
      code: "/**\n * v1.4.25 W4 — the routed sub-page.\n * v1.4.27 F17 — gated on one observation.\n */\nconst x = 1;",
      output:
        "/**\n * v1.4.25 — the routed sub-page.\n * v1.4.27 — gated on one observation.\n */\nconst x = 1;",
      errors: [error, error],
    },
  ],
});
