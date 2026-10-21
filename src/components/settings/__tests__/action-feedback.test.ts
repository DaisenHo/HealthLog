/**
 * Settings actions say how they went.
 *
 * Each action below finished in silence on at least one side. Adding or
 * removing a passkey or a security key only redrew the list; disconnecting an
 * integration and revoking a share link fired from a dialog that had already
 * closed, so a refused request left everything as it was and said nothing;
 * the injection-site exclusions, the local-OCR switch and the preventive-care
 * reminder switches saved, or did not, without a word.
 *
 * They use the pair the rest of the app reports a write with —
 * `toastWrittenOutcome("success", …)`, the outcome module's one door to the
 * success toast, and `showErrorToast` (which carries the error id of a server
 * failure). The passkey and security-key cards keep their inline error line,
 * which also carries the step-up dialog's outcome, and gain the success half.
 *
 * Mutation callbacks only run after an interaction, so the wiring is read
 * from the source: per action, the success callback raises the success
 * outcome and, where the card has no inline error line, the error callback raises
 * `showErrorToast`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

interface Site {
  file: string;
  /** `const <name> = useMutation({…})`, or `<name>.mutate(…, {…})`. */
  name: string;
  shape: "definition" | "call";
  needsErrorToast: boolean;
}

const SITES: Site[] = [
  {
    file: "src/components/settings/security-section/passkey-list-section.tsx",
    name: "add",
    shape: "definition",
    needsErrorToast: false,
  },
  {
    file: "src/components/settings/security-section/passkey-list-section.tsx",
    name: "remove",
    shape: "definition",
    needsErrorToast: false,
  },
  {
    file: "src/components/settings/security-section/security-keys-card.tsx",
    name: "add",
    shape: "definition",
    needsErrorToast: false,
  },
  {
    file: "src/components/settings/security-section/security-keys-card.tsx",
    name: "remove",
    shape: "definition",
    needsErrorToast: false,
  },
  {
    file: "src/components/settings/integrations/oauth-integration-card.tsx",
    name: "disconnect",
    shape: "definition",
    needsErrorToast: true,
  },
  {
    file: "src/components/settings/sharing-section.tsx",
    name: "revokeMutation",
    shape: "definition",
    needsErrorToast: true,
  },
  {
    file: "src/components/settings/injection-sites-card.tsx",
    name: "mutation",
    shape: "definition",
    needsErrorToast: true,
  },
  {
    file: "src/components/labs/labs-settings.tsx",
    name: "updateLocalOcr",
    shape: "call",
    needsErrorToast: true,
  },
  {
    file: "src/components/measurement-reminders/vorsorge-settings.tsx",
    name: "update",
    shape: "call",
    needsErrorToast: true,
  },
];

/** The `{ onSuccess, onError, … }` literal for a site, or null. */
function callbacks(site: Site): ts.ObjectLiteralExpression | null {
  const text = readFileSync(join(process.cwd(), site.file), "utf8");
  const sf = ts.createSourceFile(site.file, text, ts.ScriptTarget.Latest, true);
  let found: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (
      site.shape === "definition" &&
      ts.isVariableDeclaration(node) &&
      node.name.getText(sf) === site.name &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      node.initializer.expression.getText(sf) === "useMutation"
    ) {
      const arg = node.initializer.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) found = arg;
    }
    if (
      site.shape === "call" &&
      ts.isCallExpression(node) &&
      node.expression.getText(sf) === `${site.name}.mutate`
    ) {
      const arg = node.arguments[1];
      if (arg && ts.isObjectLiteralExpression(arg)) found = arg;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function property(obj: ts.ObjectLiteralExpression, name: string): string {
  const prop = obj.properties.find((p) => p.name && p.name.getText() === name);
  return prop ? prop.getText() : "";
}

describe("settings actions report their outcome", () => {
  for (const site of SITES) {
    describe(`${site.file} → ${site.name}`, () => {
      const obj = callbacks(site);

      it("is found", () => {
        expect(obj, "the mutation options were not found").not.toBeNull();
      });

      it("raises a success toast", () => {
        expect(property(obj!, "onSuccess")).toMatch(
          /toastWrittenOutcome\(\s*"success"/,
        );
      });

      if (site.needsErrorToast) {
        it("raises an error toast through showErrorToast", () => {
          expect(property(obj!, "onError")).toContain("showErrorToast(");
        });
      }
    });
  }
});
