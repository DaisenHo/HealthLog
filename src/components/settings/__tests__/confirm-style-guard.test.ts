/**
 * One confirm style across Settings.
 *
 * A destructive act (delete, revoke, remove, reset, sign out) confirms through
 * `ConfirmButton` / `ConfirmDialog` (`src/components/ui/confirm-button.tsx`),
 * which owns the dialog's anatomy and wears the destructive style when the
 * caller says the act is destructive. A hand-built `AlertDialog` is how the
 * same question ended up styled three different ways on neighbouring cards.
 *
 * So no file under `src/components/settings` imports the raw `AlertDialog`
 * unless it is listed below with the reason the primitive does not fit.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src", "components", "settings");

const ALLOWED: Readonly<Record<string, string>> = {
  "security-section/existing-factor-reauth-dialog.tsx":
    "a re-authentication form, not a destructive confirm",
  "security-section/passkey-list-section.tsx":
    "the add-passkey re-authentication form; the delete confirm uses ConfirmButton",
  "security-section/totp-card.tsx":
    "the disable confirm asks for a current code and stays open until the server answers; both actions wear the destructive style",
};

/** Owned by the integration cards, which follow their own card kit. */
const ALLOWED_PREFIXES: readonly string[] = ["integrations/"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : walk(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const IMPORTS_ALERT_DIALOG = /from\s+["']@\/components\/ui\/alert-dialog["']/;

describe("settings confirm style", () => {
  const files = walk(ROOT);

  it("scans the settings tree", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("imports the raw AlertDialog only where the primitive does not fit", () => {
    const offenders = files
      .map((path) => relative(ROOT, path))
      .filter((rel) =>
        IMPORTS_ALERT_DIALOG.test(readFileSync(join(ROOT, rel), "utf8")),
      )
      .filter(
        (rel) =>
          !(rel in ALLOWED) &&
          !ALLOWED_PREFIXES.some((prefix) => rel.startsWith(prefix)),
      );
    expect(
      offenders,
      "Confirm a destructive act through ConfirmButton / ConfirmDialog, or list the file here with the reason",
    ).toEqual([]);
  });

  it("lists no file that no longer needs the exemption", () => {
    const stale = Object.keys(ALLOWED).filter(
      (rel) =>
        !IMPORTS_ALERT_DIALOG.test(readFileSync(join(ROOT, rel), "utf8")),
    );
    expect(stale).toEqual([]);
  });
});
