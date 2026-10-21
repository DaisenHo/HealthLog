/**
 * A confirmation whose act takes something away wears the destructive style.
 *
 * `ConfirmButton` accepted a `destructive` prop and dropped it on the way to
 * its dialog, so every delete, revoke and remove built on it asked its
 * question over a neutral primary button — while the documents vault, which
 * uses `ConfirmDialog`, asked the same question in red. The primitive forwards
 * it now (`confirm-button.test.tsx` pins the wiring); this file pins that the
 * call sites ask for it.
 *
 * The judgement "does this act destroy" is read off the `slot` the call site
 * already names: a slot that says delete, remove, revoke, renounce, forget,
 * clear or disconnect is that act. A reset is deliberately not in the list:
 * it puts back a default the person can change again, and stays neutral.
 * A slot without one of those words is not checked, which is the honest
 * limit of a name-based rule; the slot is the one label every call site
 * carries, and it is what the destructive-control registry is keyed on too.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

import { walkSourceFiles } from "./helpers/source-files";

const SRC = join(process.cwd(), "src");
const DESTROYING = /(delete|remove|revoke|renounce|forget|clear|disconnect)/i;
const TAGS = new Set(["ConfirmButton", "ConfirmDialog"]);

interface Site {
  file: string;
  slot: string;
  destructive: boolean;
}

function slotText(attr: ts.JsxAttribute): string | null {
  const init = attr.initializer;
  if (!init) return null;
  if (ts.isStringLiteral(init)) return init.text;
  if (ts.isJsxExpression(init) && init.expression) {
    const expr = init.expression;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return expr.text;
    }
    if (ts.isTemplateExpression(expr)) return expr.head.text;
  }
  return null;
}

function collect(): Site[] {
  const sites: Site[] = [];
  for (const rel of walkSourceFiles(SRC, {
    floor: 1200,
    extensions: [".tsx"],
  })) {
    if (rel.includes("__tests__/") || rel.startsWith("generated/")) continue;
    const text = readFileSync(join(SRC, rel), "utf8");
    if (!text.includes("<Confirm")) continue;
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      const opening = ts.isJsxSelfClosingElement(node)
        ? node
        : ts.isJsxElement(node)
          ? node.openingElement
          : null;
      if (opening && TAGS.has(opening.tagName.getText(sf))) {
        let slot: string | null = null;
        let destructive = false;
        for (const prop of opening.attributes.properties) {
          if (!ts.isJsxAttribute(prop)) continue;
          const name = prop.name.getText(sf);
          if (name === "slot") slot = slotText(prop);
          if (name === "destructive") destructive = true;
        }
        if (slot !== null) sites.push({ file: rel, slot, destructive });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return sites;
}

describe("destroying confirmations wear the destructive style", () => {
  const sites = collect();

  it("finds the confirmations it is meant to check", () => {
    // A matcher that found nothing would agree with any tree.
    expect(sites.filter((s) => DESTROYING.test(s.slot)).length).toBeGreaterThan(
      15,
    );
  });

  it("every one whose slot names a destroying act passes `destructive`", () => {
    const missing = sites
      .filter((s) => DESTROYING.test(s.slot) && !s.destructive)
      .map((s) => `${s.file}: ${s.slot}`);
    expect(
      missing,
      "Pass `destructive` so the confirm button is red, or rename the slot if the act does not take anything away.",
    ).toEqual([]);
  });
});
