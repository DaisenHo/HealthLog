/**
 * v1.43 — pair guard binding the `MedicationIngredient` model to both ends of
 * the backup: the writer's `ingredients: m.ingredients.map(...)` block in
 * `full-backup-payload.ts` and the nested create in `restore-backup.ts`.
 *
 * The failure it catches is the one the measurement guard beside it was
 * written for: a column added to the composition in a later release, the
 * writer or the restore left as "the follow-up", the payload schema's
 * `.passthrough()` swallowing it, and the column coming back empty on every
 * restored row. The column-by-column round trip
 * (`tests/integration/backup-round-trip.test.ts`) proves the same against a
 * database; this is the fast edge of it that runs with the unit suite.
 *
 * Mutation check: delete `enteredUnit: i.enteredUnit,` from the writer and the
 * first leg names `enteredUnit`; delete `source: i.source,` from the restore
 * and the second leg names `source`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

/**
 * Columns neither end carries, each with its reason.
 *  - `userId`: re-derived from the restoring account.
 *  - `medicationId`: the rows are nested in their medication on both ends, so
 *    the restore binds them to whatever id the medication got.
 *  - `updatedAt`: `@updatedAt`, stamped by the restore's own write.
 */
const EXCLUDED: Record<string, string> = {
  userId: "owner re-derived from the restoring account",
  medicationId: "nested in its medication; bound by the nested create",
  updatedAt: "@updatedAt; stamped by the restore's write",
};

function modelColumns(): string[] {
  const schema = read("prisma", "schema.prisma");
  const start = schema.indexOf("model MedicationIngredient {");
  expect(start).toBeGreaterThan(-1);
  const block = schema.slice(start, schema.indexOf("\n}", start));
  const out: string[] = [];
  for (const raw of block.split("\n").slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const m = /^([a-zA-Z_]\w*)\s+([A-Za-z_]\w*)/.exec(line);
    if (!m || line.includes("@relation")) continue;
    out.push(m[1]);
  }
  return out;
}

/** The keys one end's ingredient block names, read off `<key>: i.<field>`. */
function blockKeys(source: string, opener: string): Set<string> {
  const start = source.indexOf(opener);
  expect(start, `${opener} not found`).toBeGreaterThan(-1);
  const end = source.indexOf("})),", start);
  expect(end).toBeGreaterThan(start);
  const body = source.slice(start, end);
  return new Set(
    [...body.matchAll(/\b([a-zA-Z_]\w*):\s*(?:i\.|new Date\(i\.)/g)].map(
      (m) => m[1],
    ),
  );
}

describe("medication ingredient backup completeness", () => {
  const columns = modelColumns();
  const carried = columns.filter((c) => !(c in EXCLUDED));

  it("reads the model's columns", () => {
    expect(columns).toEqual(
      expect.arrayContaining(["nutrient", "amountPerUnit", "enteredUnit"]),
    );
    for (const key of Object.keys(EXCLUDED)) expect(columns).toContain(key);
  });

  it("the writer carries every column", () => {
    const keys = blockKeys(
      read("src", "lib", "export", "full-backup-payload.ts"),
      "ingredients: m.ingredients.map((i) => ({",
    );
    expect(carried.filter((c) => !keys.has(c))).toEqual([]);
  });

  it("the restore writes every column back", () => {
    const keys = blockKeys(
      read("src", "lib", "export", "restore-backup.ts"),
      "create: m.ingredients.map((i) => ({",
    );
    expect(carried.filter((c) => !keys.has(c))).toEqual([]);
  });
});
