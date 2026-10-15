/**
 * v1.43 — pair guard binding `DawarichDay` in `prisma/schema.prisma` to the
 * backup that carries it (`src/lib/export/environment-backup.ts`, the
 * `dawarichDays` arm of the environment section), on the pattern of
 * `environment-backup-completeness.test.ts`.
 *
 * A column missing from the select comes back NULL on every restored day
 * without a word, because the section schema is `.passthrough()`. So both
 * ends are compared as literals:
 *
 *   - every scalar column of `DawarichDay` is in `DAWARICH_DAY_BACKUP_SELECT`
 *     (or excluded here with a reason);
 *   - every selected column is written by the export (`row.<column>`);
 *   - every selected column is written back by the restore (`<column>:`).
 *
 * Mutation check: delete `trainDistanceM: true,` from the select and the
 * first case names it; delete `trainDistanceM:` from the restore and the
 * restore case names it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const source = readFileSync(
  join(ROOT, "src", "lib", "export", "environment-backup.ts"),
  "utf8",
);

const EXCLUDED: Record<string, string> = {
  id: "nothing addresses a day by its id; a day is identified by its date",
  userId:
    "user-scoped backup; the owner is re-derived from the restoring account",
};

function block(text: string, start: string, end = "\n}"): string {
  const from = text.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = text.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

function scalarColumns(model: string): string[] {
  const models = new Set(
    [...schema.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{/gm)].map((m) => m[1]),
  );
  const out: string[] = [];
  for (const raw of block(schema, `model ${model} {`).split("\n").slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const m = /^([a-zA-Z_]\w*)\s+([A-Za-z_]\w*)(\[\])?/.exec(line);
    if (!m || m[3] || models.has(m[2]) || line.includes("@relation")) continue;
    out.push(m[1]);
  }
  return out;
}

const columns = scalarColumns("DawarichDay");
const selected = [
  ...block(source, "const DAWARICH_DAY_BACKUP_SELECT = {").matchAll(
    /^ {2}(\w+): true,$/gm,
  ),
].map((m) => m[1]);
const exportBody = block(source, "dawarichDays: dawarichRows.map(", "})),");
const restoreBody = block(
  source,
  "export async function restoreEnvironmentData(",
  "\n}\n",
);
const restoreDawarich = block(restoreBody, "tx.dawarichDay.createMany(", "});");

describe("DawarichDay backup completeness", () => {
  it("parses both ends into a plausible shape", () => {
    expect(columns).toContain("countryCodeEncrypted");
    expect(columns).toContain("awayFromHomeMinutes");
    expect(selected.length).toBeGreaterThan(8);
  });

  it("the backup select covers every column", () => {
    const missing = columns.filter(
      (c) => !selected.includes(c) && !(c in EXCLUDED),
    );
    expect(
      missing,
      "DAWARICH_DAY_BACKUP_SELECT omits these columns; a restore brings them back NULL",
    ).toEqual([]);
  });

  it("the export writes every selected column into the entry", () => {
    const unwritten = selected.filter(
      (c) => !new RegExp(`row\\.${c}\\b`).test(exportBody),
    );
    expect(unwritten, "selected but never exported").toEqual([]);
  });

  it("the restore writes every selected column back", () => {
    const unwritten = selected.filter(
      (c) => !new RegExp(`\\b${c}:`).test(restoreDawarich),
    );
    expect(unwritten, "selected but never restored").toEqual([]);
  });

  it("the restore clears the days it replaces", () => {
    expect(restoreBody).toMatch(/tx\.dawarichDay\.deleteMany\(/);
  });
});
