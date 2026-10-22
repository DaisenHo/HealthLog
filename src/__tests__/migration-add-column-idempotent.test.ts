/**
 * Structural guard: a column a migration adds is added idempotently.
 *
 * Parallel release branches each add columns to `users`, and a host that ran
 * a beta image already holds the columns a later rebuilt migration adds again.
 * A bare `ADD COLUMN` then fails the boot with "column already exists". Every
 * migration from `0422` on (the first one after the last release that shipped
 * a bare form) writes `ADD COLUMN IF NOT EXISTS`, as `0424` and `0432` did from
 * the start.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations",
);

const FIRST_GUARDED = 422;

/** Lines that add a column without `IF NOT EXISTS`, comments stripped. */
function bareAddColumns(sql: string): string[] {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .filter((line) => /\bADD\s+COLUMN\b/i.test(line))
    .filter((line) => !/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i.test(line))
    .map((line) => line.trim());
}

describe("migrations add columns idempotently", () => {
  it("recognises the bare form and accepts the guarded one", () => {
    expect(
      bareAddColumns('ALTER TABLE "u" ADD COLUMN "a" JSONB;'),
    ).toHaveLength(1);
    expect(
      bareAddColumns('ALTER TABLE "u" ADD COLUMN IF NOT EXISTS "a" JSONB;'),
    ).toEqual([]);
    expect(bareAddColumns("-- ADD COLUMN in a comment")).toEqual([]);
  });

  it(`uses ADD COLUMN IF NOT EXISTS from ${FIRST_GUARDED} on`, () => {
    const offenders: string[] = [];
    for (const entry of readdirSync(MIGRATIONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const number = Number.parseInt(entry.name.slice(0, 4), 10);
      if (!Number.isFinite(number) || number < FIRST_GUARDED) continue;
      const sql = readFileSync(
        resolve(MIGRATIONS_DIR, entry.name, "migration.sql"),
        "utf8",
      );
      for (const line of bareAddColumns(sql)) {
        offenders.push(`${entry.name}: ${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
