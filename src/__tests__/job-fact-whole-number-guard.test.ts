/**
 * A job fact is a non-negative whole number, a stable code or a boolean
 * (`src/lib/jobs/job-outcome.ts`). A producer that hands a ratio, an average
 * or a quotient over as a number passes the type checker and fails the
 * outcome's validation at run time: the nightly measurements check reported
 * its bloat factor (1.3) that way and failed every run (#1271).
 *
 * This reads every module that reports a job outcome and refuses a fact whose
 * value is a division, or names a ratio-shaped quantity (a name ending in
 * factor, ratio, average, mean, share, fraction or percent), unless it goes through
 * `wholeFact`/`percentFact` or an explicit `Math.round`/`floor`/`ceil`/`trunc`.
 * A text-level check: it sees the expression written at the fact, not what a
 * variable it names was computed from. The runtime half is `runJob`, which
 * drops and signals an invalid fact instead of failing finished work.
 */
import ts from "typescript";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { JOB_FACT_ALLOWLIST } from "@/lib/jobs/job-outcome";

import { readSourceText, walkSourceFiles } from "./helpers/source-files";
import { parse } from "./helpers/source-metrics";

const SRC = join(process.cwd(), "src");
/** The last word of a camelCase or snake_case name: what the value IS. */
const RATIO_NOUN = /^(factor|ratio|average|avg|mean|share|fraction|percent)$/;
function namesRatio(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split("_")
    .filter(Boolean);
  return RATIO_NOUN.test(words[words.length - 1] ?? "");
}
const ROUNDING_CALL =
  /^(wholeFact|percentFact|Math\.(round|floor|ceil|trunc))$/;

function roundedByCall(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isCallExpression(n) && ROUNDING_CALL.test(n.expression.getText())) {
      return true;
    }
    if (ts.isPropertyAssignment(n)) return false;
  }
  return false;
}

function suspicious(initializer: ts.Expression): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    const divides =
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.SlashToken;
    const ratioName =
      (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) &&
      namesRatio(node.text);
    if ((divides || ratioName) && !roundedByCall(node)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return found;
}

/** `file:line key` for every allowlisted fact whose value looks fractional. */
function offenders(rel: string, text: string): string[] {
  if (!text.includes("jobDone(") && !text.includes("jobFailed(")) return [];
  const source = parse(rel, text);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      JOB_FACT_ALLOWLIST.has(node.name.text) &&
      suspicious(node.initializer)
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      out.push(`${rel}:${line + 1} ${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

describe("job facts are whole numbers at the source", () => {
  const files = walkSourceFiles(SRC, { floor: 1500 }).filter(
    (rel) =>
      !rel.startsWith("generated/") &&
      !rel.includes("__tests__") &&
      !rel.endsWith(".test.ts"),
  );

  it("reads the producers it claims to check", () => {
    const producers = files.filter((rel) =>
      readSourceText(join(SRC, rel)).includes("jobDone("),
    );
    expect(producers.length).toBeGreaterThan(40);
  });

  it("finds no fact that carries a ratio or a quotient as it stands", () => {
    const found = files.flatMap((rel) =>
      offenders(rel, readSourceText(join(SRC, rel))),
    );
    expect(found).toEqual([]);
  });

  it("catches the shape it guards against, and lets the rounded one through", () => {
    const old = [
      "const facts = {",
      "  dead_rows: health.deadRows,",
      "  bloat_percent: health.bloatFactor ?? 0,",
      "  duration_ms: elapsed / 1000,",
      "};",
      "return jobDone(facts);",
    ].join("\n");
    expect(offenders("x.ts", old)).toEqual([
      "x.ts:3 bloat_percent",
      "x.ts:4 duration_ms",
    ]);
    const fixed = [
      "const facts = {",
      "  bloat_percent: percentFact(health.bloatFactor),",
      "  duration_ms: Math.round(elapsed / 1000),",
      "};",
      "return jobDone(facts);",
    ].join("\n");
    expect(offenders("x.ts", fixed)).toEqual([]);
  });
});
