/**
 * Ending a grant from the sessions card asks first.
 *
 * "Sign out everywhere" leaves accepted grants standing and lists them with a
 * one-click end. That end is the same act as the access card's revoke — it
 * takes another account's standing access to the record, permanently — but it
 * fired on the tap, while the access card asks with a dialog naming who loses
 * what. The row is state set after a mutation, out of reach of a static
 * render, so the wiring is read from the source: the revoke call may only sit
 * inside a `ConfirmButton`'s `onConfirm`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const FILE = "src/components/settings/security-sessions-card.tsx";

function revokeCallSites(): { attr: string | null; element: string | null }[] {
  const text = readFileSync(join(process.cwd(), FILE), "utf8");
  const sf = ts.createSourceFile(FILE, text, ts.ScriptTarget.Latest, true);
  const sites: { attr: string | null; element: string | null }[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sf) === "revokeGrant.mutate"
    ) {
      let attr: string | null = null;
      let element: string | null = null;
      for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
        if (ts.isJsxAttribute(p) && attr === null) attr = p.name.getText(sf);
        if (
          (ts.isJsxSelfClosingElement(p) || ts.isJsxOpeningElement(p)) &&
          attr !== null
        ) {
          element = p.tagName.getText(sf);
          break;
        }
      }
      sites.push({ attr, element });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

describe("kept-grant revoke on the sessions card", () => {
  it("fires only from a ConfirmButton's onConfirm", () => {
    const sites = revokeCallSites();
    expect(sites.length).toBeGreaterThan(0);
    for (const site of sites) {
      expect(site).toEqual({ attr: "onConfirm", element: "ConfirmButton" });
    }
  });
});
