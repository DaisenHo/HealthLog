/**
 * Unit tests for the `healthlog/import-boundaries` rule: src/lib never
 * imports components or app, and a "use client" file never makes a value
 * import of a server-only module. Covers alias and relative specifiers,
 * type-only imports, dynamic imports, re-exports, the allow map and its
 * stale-entry report.
 */

import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import nextTs from "eslint-config-next/typescript";
import rule from "../import-boundaries.js";

// The TypeScript parser the app lints with, taken from the same config so
// `import type` reaches the rule as it does in `pnpm lint`.
const tsParser = nextTs.find((c) => c.languageOptions?.parser).languageOptions
  .parser;

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2023,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

const LIB_FILE = "/repo/src/lib/medications/example.ts";
const CLIENT_FILE = "/repo/src/components/medications/example.tsx";

ruleTester.run("import-boundaries", rule, {
  valid: [
    // lib importing lib, a package, and itself relatively.
    { code: 'import { a } from "@/lib/x";', filename: LIB_FILE },
    { code: 'import { z } from "zod";', filename: LIB_FILE },
    { code: 'import { b } from "../y";', filename: LIB_FILE },
    // components importing components and lib is the right direction.
    {
      code: 'import { C } from "@/components/ui/card";',
      filename: CLIENT_FILE,
    },
    // Tests are out of scope.
    {
      code: 'import { C } from "@/components/ui/card";',
      filename: "/repo/src/lib/medications/__tests__/x.test.ts",
    },
    // An allowed lib file that still imports upward.
    {
      code: 'import { C } from "@/components/ui/card";',
      filename: LIB_FILE,
      options: [{ allow: { "src/lib/medications/example.ts": "reason" } }],
    },
    // A server component (no directive) may import the database client.
    {
      code: 'import { prisma } from "@/lib/db";',
      filename: "/repo/src/app/page.tsx",
    },
    // A client file may import types from server modules and the enums entry.
    {
      code: '"use client";\nimport type { MeasurementType } from "@/generated/prisma/client";',
      filename: CLIENT_FILE,
    },
    {
      code: '"use client";\nimport { type BackupRestoreJobView } from "@/lib/jobs/backup-restore";',
      filename: CLIENT_FILE,
    },
    {
      code: '"use client";\nimport { MeasurementType } from "@/generated/prisma/enums";',
      filename: CLIENT_FILE,
    },
    // A string that only looks like the directive is not one.
    {
      code: 'const x = "use client";\nimport { prisma } from "@/lib/db";',
      filename: CLIENT_FILE,
    },
  ],
  invalid: [
    {
      code: 'import { C } from "@/components/ui/card";',
      filename: LIB_FILE,
      errors: [{ messageId: "libUpward" }],
    },
    {
      code: 'import type { P } from "@/app/settings/page";',
      filename: LIB_FILE,
      errors: [{ messageId: "libUpward" }],
    },
    // Relative specifiers resolve to the same layer check.
    {
      code: 'import { C } from "../../components/ui/card";',
      filename: LIB_FILE,
      errors: [{ messageId: "libUpward" }],
    },
    {
      code: 'export { C } from "@/components/ui/card";',
      filename: LIB_FILE,
      errors: [{ messageId: "libUpward" }],
    },
    {
      code: 'const m = await import("@/components/ui/card");',
      filename: LIB_FILE,
      errors: [{ messageId: "libUpward" }],
    },
    // An allowed file that stopped importing upward must leave the list.
    {
      code: 'import { a } from "@/lib/x";',
      filename: LIB_FILE,
      options: [{ allow: { "src/lib/medications/example.ts": "reason" } }],
      errors: [{ messageId: "staleAllow" }],
    },
    // Server-only modules in a client file.
    {
      code: '"use client";\nimport { prisma } from "@/lib/db";',
      filename: CLIENT_FILE,
      errors: [{ messageId: "clientServerOnly" }],
    },
    {
      code: '"use client";\nimport { encrypt } from "@/lib/crypto";',
      filename: CLIENT_FILE,
      errors: [{ messageId: "clientServerOnly" }],
    },
    {
      code: '"use client";\nimport { MeasurementType } from "@/generated/prisma/client";',
      filename: CLIENT_FILE,
      errors: [{ messageId: "clientServerOnly" }],
    },
    {
      code: '"use client";\nimport { enqueue } from "@/lib/jobs/boss-instance";',
      filename: CLIENT_FILE,
      errors: [{ messageId: "clientServerOnly" }],
    },
    {
      code: '"use client";\nimport { cookies } from "next/headers";',
      filename: CLIENT_FILE,
      errors: [{ messageId: "clientServerOnly" }],
    },
    {
      code: '"use client";\nimport { Pool } from "pg";',
      filename: CLIENT_FILE,
      errors: [{ messageId: "clientServerOnly" }],
    },
  ],
});
