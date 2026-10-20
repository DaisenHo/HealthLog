/**
 * Structural guard: every model that soft-deletes has exactly one retention
 * entry, and every entry names a model that soft-deletes.
 *
 * Twenty of the twenty-three soft-delete models had no purge at all: their
 * tombstones stayed for as long as the instance ran. The set is derived from
 * `prisma/schema.prisma` (a `deletedAt` field), so a model that starts
 * soft-deleting cannot ship without saying how long its tombstones live.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  readDeclaredSchema,
  type DeclaredSchema,
} from "@/__tests__/helpers/prisma-schema-names";
import { TOMBSTONE_RETENTION_DAYS } from "@/lib/auth/native-client";
import {
  SOFT_DELETE_RETENTION,
  purgeModels,
  type SoftDeleteRetention,
} from "@/lib/jobs/soft-delete-retention";

function problems(
  schema: DeclaredSchema,
  register: Readonly<Record<string, SoftDeleteRetention>>,
): string[] {
  const found: string[] = [];
  const softDeleting = schema.models.filter((model) =>
    model.fields.some((f) => f.name === "deletedAt"),
  );
  for (const model of softDeleting) {
    const entry = register[model.name];
    if (!entry) {
      found.push(`${model.name}: soft-deletes but has no retention entry`);
      continue;
    }
    if (entry.kind !== "purge") continue;
    if (entry.table !== model.physicalName) {
      found.push(
        `${model.name}: entry purges ${entry.table}, the model is ${model.physicalName}`,
      );
    }
    for (const column of ["user_id", "deleted_at"]) {
      if (!model.fields.some((f) => f.physicalName === column)) {
        found.push(`${model.name}: the purge needs a ${column} column`);
      }
    }
  }
  const names = new Set(softDeleting.map((m) => m.name));
  for (const name of Object.keys(register)) {
    if (!names.has(name)) {
      found.push(`${name}: has a retention entry but does not soft-delete`);
    }
  }
  return found;
}

describe("soft-delete retention register", () => {
  const schema = readDeclaredSchema();

  it("covers every soft-delete model exactly once", () => {
    const softDeleting = schema.models.filter((model) =>
      model.fields.some((f) => f.name === "deletedAt"),
    );
    // A reader that stopped matching would find nothing and pass.
    expect(softDeleting.length).toBeGreaterThanOrEqual(23);
    const found = problems(schema, SOFT_DELETE_RETENTION);
    expect(found, found.join("\n")).toEqual([]);
  });

  it("keeps every tombstone at least as long as the sync feed's horizon", () => {
    for (const [model, entry] of Object.entries(SOFT_DELETE_RETENTION)) {
      if (entry.kind !== "purge") continue;
      expect(entry.days(), model).toBeGreaterThanOrEqual(
        TOMBSTONE_RETENTION_DAYS,
      );
    }
    expect(purgeModels()).toContain("MenstrualCycle");
    expect(purgeModels()).toContain("CycleDayLog");
  });

  it("explains every entry that departs from the default", () => {
    for (const [model, entry] of Object.entries(SOFT_DELETE_RETENTION)) {
      if (entry.kind !== "purge") continue;
      const departs =
        entry.keep !== undefined || entry.days() !== TOMBSTONE_RETENTION_DAYS;
      if (departs) expect(entry.why?.length ?? 0, model).toBeGreaterThan(40);
    }
  });

  it("counter-check: names a new soft-delete model, a stale entry and a wrong table", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-retention-"));
    try {
      const path = join(dir, "schema.prisma");
      writeFileSync(
        path,
        `model Widget {
  id        String    @id
  userId    String    @map("user_id")
  deletedAt DateTime? @map("deleted_at")
  @@map("widgets")
}
model Gadget {
  id        String    @id
  userId    String    @map("user_id")
  deletedAt DateTime? @map("deleted_at")
  @@map("gadgets")
}
`,
      );
      const synthetic = readDeclaredSchema(path);
      const found = problems(synthetic, {
        Gadget: { kind: "purge", table: "gadget", days: () => 75 },
        Gone: { kind: "purge", table: "gone", days: () => 75 },
      });
      expect(found).toEqual([
        "Widget: soft-deletes but has no retention entry",
        "Gadget: entry purges gadget, the model is gadgets",
        "Gone: has a retention entry but does not soft-delete",
      ]);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
