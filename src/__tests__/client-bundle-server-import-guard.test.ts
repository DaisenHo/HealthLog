/**
 * No client component reaches a server-only module.
 *
 * A `"use client"` file ships to the browser together with everything it
 * imports, transitively. Two modules did reach the server side that way: the
 * side-effect taxonomy imported its enums from the Prisma CLIENT entry, and
 * the recurrence engine the medication wizard previews schedules with
 * imported the logging context, which brings `node:async_hooks`, `node:crypto`
 * and `node:os` with it. The build tolerated both; neither belongs in a
 * browser bundle, and the next such import could be the database client.
 *
 * The project has no `server-only` package to mark modules with, so this
 * walks the graph instead: from every `"use client"` file, through every
 * value import (`import type` is erased and not followed), and fails on any
 * reachable import of the database client, the Prisma client entry (the
 * `enums` entry is browser-safe and allowed), `next/headers`, the job queue,
 * or a Node built-in. The failure prints the chain, so the fix is obvious.
 *
 * Limits, stated: specifiers are resolved the way the app resolves `@/…` and
 * relative paths; a re-export through a package outside `src` is not
 * followed. The floors below fail the guard if the walk finds too little to
 * mean anything.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");

const NODE_BUILTIN =
  /^(node:|(fs|path|crypto|child_process|net|tls|zlib|stream|os|async_hooks|worker_threads|http|https|dns)(\/|$))/;

function isServerOnly(spec: string, file: string | null): boolean {
  if (file) {
    const rel = file.slice(SRC.length + 1);
    return rel === "lib/db.ts" || rel.startsWith("generated/prisma/client");
  }
  return (
    NODE_BUILTIN.test(spec) ||
    spec === "next/headers" ||
    spec === "pg-boss" ||
    spec === "pg" ||
    spec.startsWith("@prisma/")
  );
}

function resolveSpec(spec: string, from: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Value imports only: `import type` and all-`type` named lists are erased. */
function valueImports(source: string): string[] {
  const out: string[] = [];
  const re =
    /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([\s\S]{0,600}?)\s*from\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) {
    if (m[1]) continue;
    const clause = m[2].trim();
    if (/^\{[^}]*\}$/.test(clause)) {
      const names = clause
        .replace(/[{}\s]/g, " ")
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      if (names.length > 0 && names.every((n) => n.startsWith("type ")))
        continue;
    }
    out.push(m[3]);
  }
  for (const m of source.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g))
    out.push(m[1]);
  for (const m of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g))
    out.push(m[1]);
  return out;
}

function walkFromClients() {
  const files = walkSourceFiles(SRC, { floor: 2000 })
    .filter((f) => !f.startsWith("generated/") && !f.includes("__tests__/"))
    .filter((f) => !/\.test\.tsx?$/.test(f))
    .map((f) => join(SRC, f));
  const clients = files.filter((f) =>
    /^\s*["']use client["']/.test(readFileSync(f, "utf8")),
  );
  const parent = new Map<string, string | null>(clients.map((c) => [c, null]));
  const queue = [...clients];
  const violations: string[] = [];
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i];
    for (const spec of valueImports(readFileSync(file, "utf8"))) {
      const target = resolveSpec(spec, file);
      if (isServerOnly(spec, target)) {
        const chain = [spec];
        for (let at: string | null = file; at; at = parent.get(at) ?? null) {
          chain.unshift(at.slice(SRC.length + 1));
        }
        violations.push(chain.join(" -> "));
        continue;
      }
      if (target && !parent.has(target)) {
        parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return { clients: clients.length, reachable: parent.size, violations };
}

describe("client bundle", () => {
  const result = walkFromClients();

  it("walks enough of the tree to mean something", () => {
    expect(result.clients).toBeGreaterThan(500);
    expect(result.reachable).toBeGreaterThan(900);
  });

  it("reaches no server-only module from a client component", () => {
    expect(result.violations).toEqual([]);
  });
});
