/**
 * The boot notice `docker-entrypoint.sh` prints before `migrate deploy`
 * (`scripts/pending-migrations.mjs`), against the migrated test database.
 *
 * Every shipped migration is applied here, so the count is zero; a
 * migrations directory with one more entry than the database has applied
 * stands for a freshly pulled image, and a schema with no migrations table
 * for a first boot.
 */
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  pendingMigrations,
  pendingNotice,
  shippedMigrations,
} from "../../scripts/pending-migrations.mjs";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
});

function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for the integration run");
  return url;
}

describe("pending-migrations boot notice", () => {
  it("counts nothing pending on a database that has applied every migration", async () => {
    const pending = await pendingMigrations({
      connectionString: connectionString(),
      migrationsDir: MIGRATIONS,
    });
    expect(shippedMigrations(MIGRATIONS).length).toBeGreaterThan(300);
    expect(pending).toEqual([]);
    expect(pendingNotice(pending.length)).toBe(
      "HealthLog: Database schema is up to date.",
    );
  });

  it("counts a migration the image ships and the database has not applied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-migrations-"));
    tempDirs.push(dir);
    cpSync(MIGRATIONS, dir, { recursive: true });
    mkdirSync(join(dir, "9999_not_applied_yet"));
    writeFileSync(join(dir, "9999_not_applied_yet", "migration.sql"), "");
    // A directory without migration.sql is not a migration.
    mkdirSync(join(dir, "9998_no_sql"));

    const pending = await pendingMigrations({
      connectionString: connectionString(),
      migrationsDir: dir,
    });
    expect(pending).toEqual(["9999_not_applied_yet"]);
    const notice = pendingNotice(pending.length);
    expect(notice).toContain("1 database migration pending");
    expect(notice).toContain("pg_dump");
  });

  it("treats a schema without a migrations table as a first boot", async () => {
    const url = new URL(connectionString());
    url.searchParams.set("schema", "schema_never_migrated");
    const pending = await pendingMigrations({
      connectionString: url.toString(),
      migrationsDir: MIGRATIONS,
    });
    expect(pending).toEqual(shippedMigrations(MIGRATIONS));
    expect(pendingNotice(pending.length)).toMatch(
      /^HealthLog: \d+ database migrations pending\./,
    );
  });
});
