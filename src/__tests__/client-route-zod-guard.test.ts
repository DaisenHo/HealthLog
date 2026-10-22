/**
 * The documents vault, the Coach and the metric pages load no schema library
 * in the browser.
 *
 * Both routes reached zod through a constant: the list of document kinds, the
 * bulk limit, the attachment cap, the Coach data clusters, a conversation
 * title length, the ordering of report leaves. Each of those sat in a schema
 * module, so importing the number imported the library with it, on two of the
 * heaviest client routes (up to 89 KB gzip per route). The constants live in
 * zod-free modules now, re-exported by the schema modules for server code, and
 * the server parses what the client sends anyway.
 *
 * What this walks: the static import graph from each route's `page.tsx`, with
 * TypeScript's own parser. From the first `"use client"` module on, every
 * module it reaches statically ships to the browser; none of them may import
 * `zod`. Type-only imports are skipped (they vanish at build). A dynamic
 * `import()` is skipped too: it is a separate chunk, loaded when the code
 * that asks for it runs (the chart runtime is one), and not part of the
 * route's first load. That is the limit of this guard, stated: a lazily
 * loaded chunk may still carry zod.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";

const ROOT = join(__dirname, "..", "..");

function resolve(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = normalize(join(dirname(from), spec));
  else return null;
  for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** Value-level static imports and re-exports of one module. */
function staticImports(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false);
  const specs: string[] = [];
  for (const node of sf.statements) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      if (clause?.isTypeOnly) continue;
      const named = clause?.namedBindings;
      if (
        clause &&
        !clause.name &&
        named &&
        ts.isNamedImports(named) &&
        named.elements.length > 0 &&
        named.elements.every((e) => e.isTypeOnly)
      ) {
        continue;
      }
      specs.push((node.moduleSpecifier as ts.StringLiteral).text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      if (node.isTypeOnly) continue;
      const clause = node.exportClause;
      if (
        clause &&
        ts.isNamedExports(clause) &&
        clause.elements.length > 0 &&
        clause.elements.every((e) => e.isTypeOnly)
      ) {
        continue;
      }
      specs.push((node.moduleSpecifier as ts.StringLiteral).text);
    }
  }
  return specs;
}

function isClient(source: string): boolean {
  return /^\s*["']use client["']/.test(source);
}

/** Client modules reached from `entry` that import zod, with one path each. */
function clientZodImports(entry: string): { file: string; path: string[] }[] {
  const seen = new Map<string, boolean>();
  const parent = new Map<string, string>();
  const stack: [string, boolean][] = [[join(ROOT, entry), false]];
  const hits: string[] = [];
  let walked = 0;
  while (stack.length > 0) {
    const [file, inClient] = stack.pop()!;
    const prior = seen.get(file);
    if (prior === true || (prior === false && !inClient)) continue;
    const source = readFileSync(file, "utf8");
    const client = inClient || isClient(source);
    seen.set(file, client);
    walked += 1;
    for (const spec of staticImports(source, file)) {
      if (client && (spec === "zod" || spec.startsWith("zod/"))) {
        hits.push(file);
      }
      const next = resolve(spec, file);
      if (!next) continue;
      if (!parent.has(next)) parent.set(next, file);
      stack.push([next, client]);
    }
  }
  if (walked < 20)
    throw new Error(`walked only ${walked} modules from ${entry}`);
  return [...new Set(hits)].map((file) => {
    const path: string[] = [];
    let cursor: string | undefined = file;
    while (cursor && path.length < 10) {
      path.push(cursor.slice(ROOT.length + 1));
      cursor = parent.get(cursor);
    }
    return { file: file.slice(ROOT.length + 1), path };
  });
}

describe("client routes without the schema library", () => {
  for (const route of [
    "src/app/documents/page.tsx",
    "src/app/coach/page.tsx",
    "src/app/coach/conversations/page.tsx",
    // The metric sub-pages read the plausibility band through the value
    // domain (`src/lib/measurements/value-ranges.ts`), and the values list
    // checks its segment against the type label map.
    "src/app/insights/pulse/page.tsx",
    "src/app/insights/values/[type]/page.tsx",
  ]) {
    it(`${route} ships no zod in its static client graph`, () => {
      const hits = clientZodImports(route);
      expect(
        hits.map((h) => h.path.join(" <- ")),
        "Move the constant the client needs into a zod-free module (see src/lib/documents/inbound-constants.ts) and re-export it from the schema module.",
      ).toEqual([]);
    });
  }

  it("sees a zod import where one is", () => {
    // The schema module is zod by definition; walked as a client entry it
    // must be reported, or the walk above proves nothing.
    const probe = join(ROOT, "src/lib/validations/inbound-documents.ts");
    const source = readFileSync(probe, "utf8");
    expect(staticImports(source, probe).some((s) => s.startsWith("zod"))).toBe(
      true,
    );
    expect(
      staticImports(
        'import type { A } from "zod";\nimport { type B } from "zod";\nimport { c } from "zod/v4";\nexport { d } from "./x";\nexport type { E } from "./y";',
        "probe.ts",
      ),
    ).toEqual(["zod/v4", "./x"]);
  });
});
