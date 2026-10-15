/**
 * v1.43 — pair guard binding the five relation link tables in
 * `prisma/schema.prisma` to the backup that carries them
 * (`src/lib/export/relation-links-backup.ts`), on the pattern of
 * `environment-backup-completeness.test.ts`.
 *
 * A link table is two ids and an instant, and the failure this guards is the
 * quiet one: a table the backup does not read comes back empty after a
 * restore, every record it joined still there and no longer pointing at its
 * partner, and nothing fails. So each end is compared as a literal:
 *
 *   - every relation link table of the matrix is a two-ended model of the
 *     backup plan, not on the debt register;
 *   - every scalar column of each table is read by the export's select (or
 *     excluded here with a reason);
 *   - every read column is written back by the restore's `createMany`;
 *   - the wire schema names the same two ends for the section key.
 *
 * Mutation check: delete `documentId: true` from the lab-result select and
 * the export case names it; delete the `MedicationConditionLink` line from
 * `TWO_ENDED_MODELS` and the plan case names it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  BACKED_UP_MODELS,
  COVERAGE_PENDING,
  TWO_ENDED_MODELS,
} from "@/lib/export/backup-plan";
import { RELATION_LINK_SECTION_KEYS } from "@/lib/export/relation-links-backup";

const ROOT = process.cwd();
const schema = readFileSync(join(ROOT, "prisma", "schema.prisma"), "utf8");
const source = readFileSync(
  join(ROOT, "src", "lib", "export", "relation-links-backup.ts"),
  "utf8",
);
const wire = readFileSync(
  join(ROOT, "src", "lib", "validations", "backup.ts"),
  "utf8",
);

/** The five tables v1.43 adds to close the relation matrix. */
const RELATION_LINK_MODELS = [
  "LabResultDocumentLink",
  "EncounterMedicationLink",
  "EncounterVaccinationLink",
  "MedicationDocumentLink",
  "MedicationConditionLink",
] as const;

/** Columns the backup is right to leave out, with the reason. */
const EXCLUDED: Record<string, string> = {
  id: "nothing addresses a link row by id; the pair is its identity (unique)",
  userId:
    "user-scoped backup; the owner is re-derived from the restoring account",
};

function block(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from, `${start} not found`).toBeGreaterThan(-1);
  const to = text.indexOf(end, from);
  expect(to, `${end} not found after ${start}`).toBeGreaterThan(from);
  return text.slice(from, to);
}

function scalarColumns(model: string): string[] {
  const models = new Set(
    [...schema.matchAll(/^model\s+([A-Za-z_]\w*)\s*\{/gm)].map((m) => m[1]),
  );
  const out: string[] = [];
  for (const raw of block(schema, `model ${model} {`, "\n}")
    .split("\n")
    .slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("@@")) continue;
    const m = /^([a-zA-Z_]\w*)\s+([A-Za-z_]\w*)(\[\])?/.exec(line);
    if (!m || m[3] || models.has(m[2]) || line.includes("@relation")) continue;
    out.push(m[1]);
  }
  return out;
}

const delegate = (model: string) => model[0].toLowerCase() + model.slice(1);

describe("relation link tables in the backup plan", () => {
  it.each(RELATION_LINK_MODELS)("%s travels both ways", (model) => {
    expect(BACKED_UP_MODELS as readonly string[]).toContain(model);
    expect(TWO_ENDED_MODELS as readonly string[]).toContain(model);
    expect(COVERAGE_PENDING).not.toHaveProperty(model);
  });

  it("names one section key per table", () => {
    expect([...RELATION_LINK_SECTION_KEYS].sort()).toEqual(
      RELATION_LINK_MODELS.map((m) => `${delegate(m)}s`).sort(),
    );
  });
});

describe.each(RELATION_LINK_MODELS)("%s backup completeness", (model) => {
  const columns = scalarColumns(model);
  const name = delegate(model);
  const exported = block(source, `prisma.${name}.findMany(`, "}),");
  const restored = block(source, `tx.${name}.createMany(`, "skipDuplicates");
  const wired = block(wire, `    ${name}s: z`, ".default([])");
  const ends = columns.filter((c) => !(c in EXCLUDED) && c !== "createdAt");

  it("parses both ends into a plausible shape", () => {
    expect(columns).toEqual(
      expect.arrayContaining(["id", "userId", "createdAt"]),
    );
    expect(ends).toHaveLength(2);
  });

  it("the export reads every column", () => {
    const missing = columns.filter(
      (c) => !(c in EXCLUDED) && !new RegExp(`\\b${c}: true\\b`).test(exported),
    );
    expect(missing, `the export omits these ${model} columns`).toEqual([]);
  });

  it("the restore writes every column back", () => {
    const unwritten = ends.filter(
      (c) => !new RegExp(`\\b${c}: r\\.${c}\\b`).test(restored),
    );
    expect(unwritten, `the restore drops these ${model} columns`).toEqual([]);
    // `stamp(...)` writes the owner and the original filing instant.
    expect(restored).toMatch(/\.\.\.stamp\(r\.createdAt\)/);
  });

  it("the wire schema names the same two ends", () => {
    for (const end of ends) {
      expect(wired, `${name}s wire schema`).toContain(`"${end}"`);
    }
  });
});
