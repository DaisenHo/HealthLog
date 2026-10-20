/**
 * The boot's `migrate deploy` (`scripts/migrate-deploy.mjs`) runs every
 * migration in a UTC session, whatever the database's own default zone.
 *
 * A role whose default `TimeZone` is Europe/Berlin stands in for a shared
 * Postgres configured that way. One migration records the session zone and
 * the instant a `timestamp` → `timestamptz` cast lands on, which is what a
 * migration mixing the two types (0372) depends on. Through the wrapper both
 * read UTC; through the bare Prisma CLI, the counter-check, they read Berlin,
 * which proves the role default is what the wrapper overrode.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROLE = "hl_tz_probe";
const PASSWORD = "tz-probe";
const ROOT = process.cwd();
const PRISMA_CLI = join(ROOT, "node_modules", "prisma", "build", "index.js");

const dirs: string[] = [];

function adminUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set for the integration run");
  const url = new URL(raw);
  url.searchParams.delete("schema");
  return url;
}

async function admin(): Promise<Client> {
  const client = new Client({ connectionString: adminUrl().toString() });
  await client.connect();
  return client;
}

/** A URL that logs in as the Berlin-default role, into its own schema. */
function probeUrl(schema: string): string {
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.username = ROLE;
  url.password = PASSWORD;
  url.searchParams.set("schema", schema);
  return url.toString();
}

beforeAll(async () => {
  const db = await admin();
  await db.query(`DROP OWNED BY ${ROLE}`).catch(() => {});
  await db.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await db.query(`CREATE ROLE ${ROLE} LOGIN SUPERUSER PASSWORD '${PASSWORD}'`);
  await db.query(`ALTER ROLE ${ROLE} SET timezone = 'Europe/Berlin'`);
  await db.end();
});

afterAll(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  const db = await admin();
  for (const schema of ["tz_probe_wrapper", "tz_probe_bare"]) {
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  }
  await db.query(`DROP OWNED BY ${ROLE}`).catch(() => {});
  await db.query(`DROP ROLE IF EXISTS ${ROLE}`);
  await db.end();
});

function migrationsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hl-migrate-utc-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "schema.prisma"),
    'datasource db {\n  provider = "postgresql"\n}\n',
  );
  mkdirSync(join(dir, "migrations", "0001_zone_probe"), { recursive: true });
  cpSync(
    join(ROOT, "prisma", "migrations", "migration_lock.toml"),
    join(dir, "migrations", "migration_lock.toml"),
  );
  writeFileSync(
    join(dir, "migrations", "0001_zone_probe", "migration.sql"),
    `CREATE TABLE "zone_probe" AS
       SELECT current_setting('TimeZone') AS zone,
              ('2026-01-15 12:00:00'::timestamp)::timestamptz
                = '2026-01-15 12:00:00+00'::timestamptz AS cast_is_utc;`,
  );
  return dir;
}

function run(
  args: string[],
  databaseUrl: string,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        DATABASE_SESSION_OPTIONS_DISABLED: "",
        HEALTHLOG_PRISMA_CLI: PRISMA_CLI,
      },
    });
    let stderr = "";
    child.stdout.on("data", () => {});
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

async function probe(schema: string) {
  const db = await admin();
  const { rows } = await db.query(
    `SELECT zone, cast_is_utc FROM ${schema}.zone_probe`,
  );
  await db.end();
  return rows[0] as { zone: string; cast_is_utc: boolean };
}

describe("migrate deploy session time zone", () => {
  it("runs the migration in UTC through the boot wrapper", async () => {
    const dir = migrationsDir();
    const result = await run(
      [
        join(ROOT, "scripts", "migrate-deploy.mjs"),
        "--schema",
        join(dir, "schema.prisma"),
      ],
      probeUrl("tz_probe_wrapper"),
    );
    expect(result.code, result.stderr).toBe(0);
    expect(await probe("tz_probe_wrapper")).toEqual({
      zone: "UTC",
      cast_is_utc: true,
    });
  }, 60_000);

  it("counter-check: the bare CLI inherits the database's own zone", async () => {
    const dir = migrationsDir();
    const result = await run(
      [PRISMA_CLI, "migrate", "deploy", "--schema", join(dir, "schema.prisma")],
      probeUrl("tz_probe_bare"),
    );
    expect(result.code, result.stderr).toBe(0);
    expect(await probe("tz_probe_bare")).toEqual({
      zone: "Europe/Berlin",
      cast_is_utc: false,
    });
  }, 60_000);
});
