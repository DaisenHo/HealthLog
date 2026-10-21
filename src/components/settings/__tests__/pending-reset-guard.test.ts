/**
 * A settings save that raises its own pending flag lowers it in a `finally`.
 *
 * The cards that hand-roll a `saving` flag around a raw `fetch` set it, await
 * the request, and cleared it on the line after. A request that never reached
 * the server (offline, a dropped connection, a timeout) rejects instead of
 * returning a response, the line after never ran, and the card stayed in its
 * saving state for good: the Telegram form, the mood reminder, the low-stock
 * threshold, the lock-screen detail switch, the Coach nudges, the profile
 * form. Every one of them disabled its own control while "saving", so the
 * only way out was a reload.
 *
 * `useMutation` owns its `isPending` and cannot get stuck this way; this
 * guard covers the hand-rolled ones. For every async function under
 * `src/components/settings` that sets one of the pending flags below to
 * `true` and then awaits, it requires a `try` whose `finally` sets the same
 * flag back to `false` — or, the older shape that is equally safe, every
 * await inside a `try` that catches, so nothing can skip the reset after it.
 * What it cannot see: a flag under another name, or a function that hands
 * the await to a helper it does not await itself.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "@/__tests__/helpers/source-files";

const ROOT = join(process.cwd(), "src/components/settings");
const PENDING_SETTER =
  /^set(Saving|Pending|Busy|Loading|Submitting|ActionLoading)$/;

interface Finding {
  where: string;
  setter: string;
  /** The flag is lowered in a `finally`, or no await can throw past the reset. */
  safe: boolean;
}

/** Is this await inside the try block of a `try` that has a `catch`? */
function caught(node: ts.Node, fn: ts.Node): boolean {
  for (let p = node.parent; p && p !== fn; p = p.parent) {
    if (
      ts.isBlock(p) &&
      ts.isTryStatement(p.parent) &&
      p.parent.tryBlock === p &&
      p.parent.catchClause
    ) {
      return true;
    }
  }
  return false;
}

type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Walk a function body without descending into nested functions. */
function ownNodes(body: ts.Node, visit: (node: ts.Node) => void): void {
  const step = (node: ts.Node) => {
    visit(node);
    if (isFunctionLike(node)) return;
    ts.forEachChild(node, step);
  };
  ts.forEachChild(body, step);
}

function setterCall(node: ts.Node, sf: ts.SourceFile, value: string) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    PENDING_SETTER.test(node.expression.text) &&
    node.arguments.length === 1 &&
    node.arguments[0].getText(sf) === value
  );
}

function scan(): Finding[] {
  const findings: Finding[] = [];
  for (const rel of walkSourceFiles(ROOT, { floor: 150 })) {
    if (rel.includes("__tests__/")) continue;
    const text = readFileSync(join(ROOT, rel), "utf8");
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    const visitFn = (node: ts.Node) => {
      if (
        isFunctionLike(node) &&
        node.body &&
        node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      ) {
        const raised = new Set<string>();
        const awaits: ts.Node[] = [];
        ownNodes(node.body, (n) => {
          if (setterCall(n, sf, "true")) {
            raised.add(
              ((n as ts.CallExpression).expression as ts.Identifier).text,
            );
          }
          if (ts.isAwaitExpression(n)) awaits.push(n);
        });
        const allCaught = awaits.every((a) => caught(a, node));
        if (awaits.length > 0) {
          for (const setter of raised) {
            let resetInFinally = false;
            ownNodes(node.body, (n) => {
              if (!ts.isTryStatement(n) || !n.finallyBlock) return;
              ownNodes(n.finallyBlock, (m) => {
                if (
                  setterCall(m, sf, "false") &&
                  ((m as ts.CallExpression).expression as ts.Identifier)
                    .text === setter
                ) {
                  resetInFinally = true;
                }
              });
            });
            const line =
              sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            findings.push({
              where: `${rel}:${line}`,
              setter,
              safe: resetInFinally || allCaught,
            });
          }
        }
      }
      ts.forEachChild(node, visitFn);
    };
    visitFn(sf);
  }
  return findings;
}

describe("settings saves cannot stay pending after a failed request", () => {
  const findings = scan();

  it("finds the hand-rolled saves it is meant to check", () => {
    // A matcher that found nothing would pass on any tree.
    expect(findings.length).toBeGreaterThan(10);
  });

  it("every one lowers its flag in a finally", () => {
    const stuck = findings
      .filter((f) => !f.safe)
      .map((f) => `${f.where} (${f.setter})`);
    expect(
      stuck,
      "Move the reset into `finally`, so a request that rejects (offline, timeout) cannot leave the card saving.",
    ).toEqual([]);
  });
});
