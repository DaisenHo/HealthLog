/**
 * The boot's `migrate deploy` (`scripts/migrate-deploy.mjs`) against the real
 * Prisma CLI and Postgres: migration 0412's lock wait, and the retry after it.
 *
 * Runs 0412's own text (its ten-second timeout cut to one) in a schema of its
 * own, on a minimal `measurements` table, while another session holds the
 * lock an anti-wraparound autovacuum would hold. Prisma runs a migration file
 * statement by statement, so this is the only place the timeout and the
 * all-or-nothing `DO` block are proven the way they will run on a host; a
 * multi-statement `pg` query is one implicit transaction and would prove both
 * even for a file that cannot deliver them.
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

const SCHEMA = "lock_retry_probe";
const NAME = "0412_measurement_hot_updates";
const ROOT = process.cwd();

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  const db = await connect();
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

function baseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set for the integration run");
  return url;
}

function probeUrl(): string {
  const url = new URL(baseUrl());
  url.searchParams.set("schema", SCHEMA);
  return url.toString();
}

async function connect(): Promise<Client> {
  const url = new URL(baseUrl());
  url.searchParams.delete("schema");
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  return client;
}

/**
 * A migrations directory whose first migration creates the probe table
 * (Prisma will not migrate a schema it did not build) and is applied here.
 */
async function migrationsDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "hl-lock-retry-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "schema.prisma"),
    'datasource db {\n  provider = "postgresql"\n}\n',
  );
  mkdirSync(join(dir, "migrations", "0001_probe_table"), { recursive: true });
  cpSync(
    join(ROOT, "prisma", "migrations", "migration_lock.toml"),
    join(dir, "migrations", "migration_lock.toml"),
  );
  writeFileSync(
    join(dir, "migrations", "0001_probe_table", "migration.sql"),
    `CREATE TABLE "measurements" (
       "id" integer PRIMARY KEY, "value" integer,
       "updated_at" timestamp(3), "sync_version" integer);`,
  );
  const setup = await migrateDeploy(dir);
  expect(setup.code, setup.stderr).toBe(0);
  return dir;
}

/** Add 0412's own text, its timeout cut to one second, optionally unmarked. */
function add0412(dir: string, { marked }: { marked: boolean }): void {
  const original = readFileSync(
    join(ROOT, "prisma", "migrations", NAME, "migration.sql"),
    "utf8",
  );
  let sql = original.replace("'lock_timeout', '10s'", "'lock_timeout', '1s'");
  expect(
    sql,
    "0412 still sets its timeout the way this test shortens it",
  ).not.toBe(original);
  if (!marked) sql = sql.replace(/^-- @retry-on-lock-timeout\n/m, "");
  mkdirSync(join(dir, "migrations", NAME), { recursive: true });
  writeFileSync(join(dir, "migrations", NAME, "migration.sql"), sql);
}

function migrateDeploy(
  dir: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        join(ROOT, "scripts", "migrate-deploy.mjs"),
        "--schema",
        join(dir, "schema.prisma"),
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          DATABASE_URL: probeUrl(),
          HEALTHLOG_PRISMA_CLI: join(
            ROOT,
            "node_modules",
            "prisma",
            "build",
            "index.js",
          ),
          HEALTHLOG_MIGRATIONS_DIR: join(dir, "migrations"),
          HEALTHLOG_MIGRATE_LOCK_RETRY_DELAYS: "2,2,2",
        },
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/** Hold what an anti-wraparound autovacuum holds on the probe table. */
async function holdLock(): Promise<Client> {
  const holder = await connect();
  await holder.query("BEGIN");
  await holder.query(
    `LOCK TABLE ${SCHEMA}.measurements IN SHARE UPDATE EXCLUSIVE MODE`,
  );
  return holder;
}

async function state(db: Client) {
  const rows = await db.query(
    `SELECT migration_name, finished_at IS NOT NULL AS finished,
            rolled_back_at IS NOT NULL AS rolled_back, logs
       FROM ${SCHEMA}._prisma_migrations ORDER BY started_at`,
  );
  const trigger = await db.query(
    `SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND t.tgname = 'measurements_noop_update_keeps_stamps'`,
    [SCHEMA],
  );
  const options = await db.query(
    `SELECT c.reloptions FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = 'measurements'`,
    [SCHEMA],
  );
  return {
    migrations: rows.rows,
    trigger: trigger.rowCount === 1,
    reloptions: (options.rows[0]?.reloptions ?? []) as string[],
  };
}

beforeEach(async () => {
  const db = await connect();
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
});

describe("migration 0412 under a held lock", () => {
  it("gives up within its timeout, changes nothing, and the boot retries it", async () => {
    const dir = await migrationsDir();
    add0412(dir, { marked: true });
    const holder = await holdLock();
    // The first attempt meets the lock; the holder lets go during the backoff.
    const release = setTimeout(() => {
      void holder.query("ROLLBACK");
    }, 2_500);
    const startedAt = Date.now();
    const result = await migrateDeploy(dir);
    clearTimeout(release);
    await holder.query("ROLLBACK").catch(() => {});
    await holder.end();

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain("Database error code: 55P03");
    expect(result.stdout).toContain(
      `migration ${NAME} timed out waiting for a lock (55P03)`,
    );
    expect(Date.now() - startedAt).toBeLessThan(45_000);

    const db = await connect();
    const after = await state(db);
    await db.end();
    expect(
      after.migrations.map((m) => [
        m.migration_name,
        m.finished,
        m.rolled_back,
      ]),
    ).toEqual([
      ["0001_probe_table", true, false],
      [NAME, false, true],
      [NAME, true, false],
    ]);
    expect(after.trigger).toBe(true);
    expect(after.reloptions).toContain("fillfactor=85");
  }, 90_000);

  it("leaves nothing half-applied, stays fatal unmarked, and a later boot recovers", async () => {
    const dir = await migrationsDir();
    add0412(dir, { marked: false });
    const holder = await holdLock();
    let result;
    try {
      result = await migrateDeploy(dir);
    } finally {
      await holder.query("ROLLBACK").catch(() => {});
      await holder.end();
    }
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("not marked safe to re-run");

    const db = await connect();
    const failed = await state(db);
    // The lock-taking statements rolled back as one: no trigger, no options.
    expect(failed.trigger).toBe(false);
    expect(failed.reloptions).toEqual([]);
    expect(failed.migrations).toHaveLength(2);
    expect(failed.migrations[1]).toMatchObject({
      migration_name: NAME,
      finished: false,
      rolled_back: false,
    });
    expect(failed.migrations[1].logs).toContain("Database error code: 55P03");

    // The next image ships the marked file; its boot meets P3009 and reads
    // the cause from the stored row.
    add0412(dir, { marked: true });
    const recovered = await migrateDeploy(dir);
    expect(recovered.code, recovered.stderr).toBe(0);
    expect(recovered.stderr).toContain("P3009");
    const after = await state(db);
    await db.end();
    expect(after.trigger).toBe(true);
    expect(after.migrations.at(-1)).toMatchObject({
      finished: true,
      rolled_back: false,
    });
  }, 90_000);
});
