/**
 * Structural guard: how a migration bounds its lock wait, and when the boot
 * may retry it.
 *
 * `prisma migrate deploy` runs a migration file statement by statement, each
 * committing on its own; it does not wrap the file in a transaction. Two
 * consequences were written into this repository the other way round:
 *
 * - A top-level `SET LOCAL lock_timeout` does nothing (there is no
 *   transaction for it to be local to), so the migration waits as long as
 *   the lock is held, and every write to the table queues behind it.
 * - A file that fails half-way stays half-applied, so marking it rolled back
 *   and running it again can fail on what already exists, or apply a change
 *   twice.
 *
 * So a lock wait is bounded inside a `DO` block with
 * `set_config('lock_timeout', …, true)`, which is one statement and rolls back
 * whole; and the `-- @retry-on-lock-timeout` marker, which lets
 * `scripts/migrate-deploy.mjs` retry a 55P03 failure on boot, is allowed only
 * on a file whose every other statement is harmless to run again.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { RETRY_MARKER } from "../../scripts/migrate-deploy.mjs";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

function migrations(): Array<{ name: string; sql: string }> {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(MIGRATIONS_DIR, entry.name, "migration.sql"))
    .filter((file) => existsSync(file))
    .map((file) => ({
      name: file.split("/").at(-2) ?? file,
      sql: readFileSync(file, "utf8"),
    }));
}

/** The statements of a file, comments removed, dollar-quoted bodies blanked. */
function topLevelStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "$BODY$")
    .split(";")
    .map((statement) => statement.trim().replace(/\s+/g, " "))
    .filter((statement) => statement.length > 0);
}

/** Statements that leave the database as they found it when run twice. */
const REPEATABLE = [
  /^DO \$BODY\$$/i,
  /^CREATE OR REPLACE (FUNCTION|VIEW|PROCEDURE) /i,
  /^CREATE (UNIQUE )?INDEX IF NOT EXISTS /i,
  /^CREATE TABLE IF NOT EXISTS /i,
  /^ALTER TABLE "?\w+"? ADD COLUMN IF NOT EXISTS /i,
  /^DROP (INDEX|TRIGGER|FUNCTION|TABLE) IF EXISTS /i,
];

/** A session setting changed outside a transaction-scoped `DO` body. */
const TOP_LEVEL_TIMEOUT =
  /^SET (LOCAL |SESSION )?(lock_timeout|statement_timeout)\b|^SET LOCAL\b/i;

function violations(name: string, sql: string): string[] {
  const found: string[] = [];
  const statements = topLevelStatements(sql);
  for (const statement of statements) {
    if (TOP_LEVEL_TIMEOUT.test(statement)) {
      found.push(`${name}: top-level "${statement}" has no effect`);
    }
  }
  const boundsLockWait = /set_config\(\s*'lock_timeout'/i.test(sql);
  const marked = RETRY_MARKER.test(sql);
  if (boundsLockWait && !marked) {
    found.push(
      `${name}: bounds its lock wait but lacks -- @retry-on-lock-timeout`,
    );
  }
  if (marked) {
    for (const statement of statements) {
      if (!REPEATABLE.some((pattern) => pattern.test(statement))) {
        found.push(
          `${name}: marked retry-safe, but "${statement.slice(0, 60)}" is not repeatable`,
        );
      }
    }
  }
  return found;
}

describe("migration lock waits", () => {
  it("bounds lock waits where they take effect and marks only repeatable files", () => {
    const found = migrations().flatMap(({ name, sql }) =>
      violations(name, sql),
    );
    expect(found, found.join("\n")).toEqual([]);
  });

  it("sees the one migration that bounds its wait today", () => {
    const marked = migrations()
      .filter(({ sql }) => RETRY_MARKER.test(sql))
      .map(({ name }) => name);
    expect(marked).toContain("0412_measurement_hot_updates");
  });

  it("catches each shape it exists to refuse", () => {
    expect(violations("a", "SET LOCAL lock_timeout = '10s';")).toHaveLength(1);
    expect(
      violations(
        "b",
        "DO $x$ BEGIN PERFORM set_config('lock_timeout', '1s', true); END $x$;",
      ),
    ).toHaveLength(1);
    expect(
      violations(
        "c",
        "-- @retry-on-lock-timeout\nCREATE TRIGGER t BEFORE UPDATE ON m FOR EACH ROW EXECUTE FUNCTION f();\nDO $x$ BEGIN PERFORM set_config('lock_timeout', '1s', true); END $x$;",
      ),
    ).toEqual([expect.stringContaining("is not repeatable")]);
    expect(
      violations(
        "d",
        "-- @retry-on-lock-timeout\nCREATE OR REPLACE FUNCTION f() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END; $$;\nDO $x$ BEGIN PERFORM set_config('lock_timeout', '1s', true); END $x$;",
      ),
    ).toEqual([]);
  });
});
