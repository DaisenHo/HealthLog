/**
 * Test shapes that cannot see the bugs this repo keeps shipping may only
 * become rarer.
 *
 * Four ratchets over the test files under `src/`, each against a baseline in
 * `baselines/` (see `helpers/ratchet.ts` for the mechanics):
 *
 *   - route tests that replace the database client wholesale
 *     (`vi.mock("@/lib/db", …)`): they assert the query the route sends, not
 *     what Postgres does with it, so a `where` that matches the wrong rows
 *     passes. Behaviour belongs in `tests/integration/`;
 *   - route tests that stub `@/lib/api-handler`: they skip auth, scope, the
 *     envelope and idempotency, which is where the handler arity class hid;
 *   - `as never` casts in tests: they switch the type checker off for exactly
 *     the fixture rows that would otherwise drift loudly when a model
 *     changes;
 *   - tests that read a source file by path and assert on its text. A split
 *     or rename leaves such a test reading the wrong file, and a negative
 *     assertion then passes for the wrong reason. New ones go through
 *     `readSource(path, anchors)` or `readSourceFolder(dir, { floor })` in
 *     `helpers/source-files.ts`, which this count does not include.
 *     `readSourceText` is the unanchored reader the sweeps use; called with a
 *     fixed source path, directly or through a local wrapper that is, it is
 *     the same read without the anchors, and it counts.
 *
 * A new offender fails; one that disappears (or loses casts) fails until
 * the lower number is written back with
 * `RATCHET_WRITE=1 pnpm vitest run src/__tests__/test-realism-ratchet.test.ts`.
 *
 * Limits, stated: the database mock is matched on `vi.mock`/`vi.doMock` with
 * the `@/lib/db` specifier or a relative path ending in `lib/db`; a mock of
 * the Prisma client entry itself, or a spy on every delegate, is not a
 * pattern in use and is not matched. The source-read check is a text
 * heuristic: a file that calls `readFileSync`/`readFile` and names a source
 * path (a literal ending in `.ts`, `.tsx`, `.js` or `.mjs`), or that calls
 * `readSourceText` with such a literal, or calls a local one-parameter wrapper
 * of `readSourceText` with one. A wrapper fed from a list of paths is not
 * matched.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";

import { requireFloor } from "./helpers/source-files";
import { parse, readSrc, testSources } from "./helpers/source-metrics";
import { runRatchet, writeBackHint } from "./helpers/ratchet";

const GUARD = "src/__tests__/test-realism-ratchet.test.ts";

const DB_MOCK =
  /vi\.(?:do)?[mM]ock\(\s*["'`](?:@\/lib\/db|(?:\.\.?\/)+(?:[\w-]+\/)*lib\/db)["'`]/;
const HANDLER_STUB = /vi\.(?:do)?[mM]ock\(\s*["'`]@\/lib\/api-handler["'`]/;
const READS_FILE = /\b(?:readFileSync|readFile)\s*\(/;
const SOURCE_PATH = /["'`][^"'`\n]*\.(?:tsx?|mjs|js)["'`]/;
/** `readSourceText(...)` whose argument names a source path literal. */
const READ_SOURCE_TEXT_FIXED = new RegExp(
  String.raw`\breadSourceText\(\s*(?:join\([^)]*?)?` + SOURCE_PATH.source,
);
/** A local wrapper whose one parameter becomes the `readSourceText` path. */
const READ_SOURCE_TEXT_WRAPPER =
  /(?:function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?)\s*\(\s*(\w+)\s*(?::\s*string)?[^)]*\)[^{=]*(?:=>|\{)[\s\S]{0,160}?readSourceText\(\s*(?:join\([^)]*?\b\3\b|\3\b)/g;

/** Whether a test reads a fixed source path through `readSourceText`. */
function readsSourceTextByPath(text: string): boolean {
  if (!text.includes("readSourceText")) return false;
  if (READ_SOURCE_TEXT_FIXED.test(text)) return true;
  for (const m of text.matchAll(READ_SOURCE_TEXT_WRAPPER)) {
    const name = m[1] ?? m[2];
    if (new RegExp(`\\b${name}\\(\\s*` + SOURCE_PATH.source).test(text)) {
      return true;
    }
  }
  return false;
}

function asNeverCount(rel: string, text: string): number {
  if (!text.includes("as never")) return 0;
  let n = 0;
  const visit = (node: ts.Node): void => {
    if (
      ts.isAsExpression(node) &&
      node.type.kind === ts.SyntaxKind.NeverKeyword
    ) {
      n += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(parse(rel, text));
  return n;
}

function classifyTest(rel: string, text: string) {
  const routeTest = rel.startsWith("app/api/");
  return {
    dbMock: routeTest && DB_MOCK.test(text),
    handlerStub: routeTest && HANDLER_STUB.test(text),
    asNever: asNeverCount(rel, text),
    sourceRead:
      (READS_FILE.test(text) && SOURCE_PATH.test(text)) ||
      readsSourceTextByPath(text),
  };
}

function measure() {
  const tests = testSources();
  const dbMocks: Record<string, number> = {};
  const handlerStubs: Record<string, number> = {};
  const asNever: Record<string, number> = {};
  const sourceReads: Record<string, number> = {};
  let routeTests = 0;
  for (const rel of tests) {
    const c = classifyTest(rel, readSrc(rel));
    if (rel.startsWith("app/api/")) routeTests += 1;
    if (c.dbMock) dbMocks[rel] = 1;
    if (c.handlerStub) handlerStubs[rel] = 1;
    if (c.asNever > 0) asNever[rel] = c.asNever;
    if (c.sourceRead) sourceReads[rel] = 1;
  }
  return {
    tests: tests.length,
    routeTests,
    dbMocks,
    handlerStubs,
    asNever,
    sourceReads,
  };
}

describe("test realism ratchet", () => {
  const m = measure();

  it("reads the whole test tree", () => {
    expect(m.tests).toBeGreaterThan(2000);
    expect(m.routeTests).toBeGreaterThan(300);
    requireFloor("route tests mocking the db", Object.keys(m.dbMocks), 100);
    requireFloor("test files with as never", Object.keys(m.asNever), 100);
    requireFloor("source-reading tests", Object.keys(m.sourceReads), 100);
  });

  it.each([
    [
      "route tests that mock @/lib/db wholesale",
      "route-test-db-mocks.json",
      "dbMocks",
      "Drive the route against Postgres in tests/integration/ instead.",
    ],
    [
      "route tests that stub @/lib/api-handler",
      "route-test-handler-stubs.json",
      "handlerStubs",
      "Call the real handler, so auth, scope and the envelope run.",
    ],
    [
      "as never casts in tests",
      "test-as-never.json",
      "asNever",
      "Type the fixture (a typed builder or the Prisma payload type) instead of casting it away.",
    ],
    [
      "tests that read a source file by path",
      "test-source-reads.json",
      "sourceReads",
      "Read through readSource(path, anchors) or readSourceFolder(dir, { floor }) from src/__tests__/helpers/source-files.ts.",
    ],
  ] as const)("%s only become rarer", (label, file, key, advice) => {
    const r = runRatchet(file, m[key], {
      comment: `${label}, per test file under src/. Maintained by ${GUARD}.`,
    });
    expect(r.grew, `New or grown: ${label}. ${advice}`).toEqual([]);
    expect(r.stale, writeBackHint(GUARD)).toEqual([]);
  });
});

const READ_CALL = ["read", "File", "Sync"].join("");
// Split for the same reason: this file must not match its own pattern.
const READ_TEXT = ["read", "Source", "Text"].join("");

describe("the classifier", () => {
  it("sees the shapes it counts", () => {
    const c = classifyTest(
      "app/api/x/__tests__/route.test.ts",
      [
        'vi.mock("@/lib/db", () => ({ prisma: {} }));',
        'vi.mock("@/lib/api-handler", () => ({}));',
        "const a = {} as never; const b = [] as never;",
        // Split so this file does not count itself as a source reader.
        `const src = ${READ_CALL}(join(ROOT, "src/app/api/x/route.ts"), "utf8");`,
      ].join("\n"),
    );
    expect(c).toEqual({
      dbMock: true,
      handlerStub: true,
      asNever: 2,
      sourceRead: true,
    });
  });

  it("ignores neighbours that only look alike", () => {
    const c = classifyTest(
      "app/api/x/__tests__/route.test.ts",
      [
        'vi.mock("@/lib/db-compat", () => ({}));',
        "// cast with as never is banned",
        'const s = "as never";',
        `const fixture = ${READ_CALL}(join(DIR, "sample.xml"), "utf8");`,
      ].join("\n"),
    );
    expect(c).toEqual({
      dbMock: false,
      handlerStub: false,
      asNever: 0,
      sourceRead: false,
    });
  });

  it("counts a fixed path read through the unanchored reader", () => {
    const direct = `const src = ${READ_TEXT}(join(SRC, "lib/x.ts"));`;
    const wrapped = [
      `function read(rel: string): string {`,
      `  return ${READ_TEXT}(join(SRC, rel));`,
      `}`,
      `const src = read("lib/api-handler.ts");`,
    ].join("\n");
    expect(classifyTest("__tests__/a.test.ts", direct).sourceRead).toBe(true);
    expect(classifyTest("__tests__/a.test.ts", wrapped).sourceRead).toBe(true);
  });

  it("leaves an anchored read and a sweep through the reader alone", () => {
    const anchored = 'const src = readSource("src/lib/x.ts", "anchor");';
    const sweep = [
      `function read(rel: string): string {`,
      `  return ${READ_TEXT}(join(SRC, rel));`,
      `}`,
      `for (const rel of walkSourceFiles(SRC, { floor: 10 })) read(rel);`,
    ].join("\n");
    expect(classifyTest("__tests__/a.test.ts", anchored).sourceRead).toBe(
      false,
    );
    expect(classifyTest("__tests__/a.test.ts", sweep).sourceRead).toBe(false);
  });

  it("counts a relative database mock and only under app/api", () => {
    expect(
      classifyTest(
        "app/api/x/__tests__/a.test.ts",
        'vi.mock("../../../lib/db")',
      ).dbMock,
    ).toBe(true);
    expect(
      classifyTest("lib/x/__tests__/a.test.ts", 'vi.mock("@/lib/db")').dbMock,
    ).toBe(false);
  });
});
