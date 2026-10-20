/**
 * `prisma migrate deploy` for the container boot, with one narrow retry: a
 * migration that gave up waiting for a lock.
 *
 * Run by `docker-entrypoint.sh` as `node scripts/migrate-deploy.mjs`.
 *
 * A migration that bounds its lock wait (`lock_timeout`) fails with SQLSTATE
 * 55P03 when something holds the table longer, typically an autovacuum that
 * is preventing wraparound and does not step aside. Prisma then records the
 * attempt as failed, and every later `migrate deploy` stops at P3009 until an
 * operator runs `prisma migrate resolve --rolled-back`: under a restart
 * policy that is a container that never comes up.
 *
 * `migrate deploy` does not wrap a migration file in a transaction, so a
 * failed file is not necessarily rolled back: statements before the one that
 * failed stay applied. Marking such an attempt rolled back and running it
 * again is only safe when the file was written for it. A migration declares
 * that with a `-- @retry-on-lock-timeout` line, which its author adds only
 * when every statement before the lock-taking one is harmless to repeat and
 * the lock-taking statements form one statement (a `DO` block) that rolls
 * back whole. `src/__tests__/migration-lock-timeout-guard.test.ts` holds the
 * migrations to that.
 *
 * So: on a 55P03 failure of a migration carrying the marker, mark that one
 * migration rolled back and run `migrate deploy` again after a backoff (15,
 * 30, 60, 120, 240 seconds). Any other failure, a lock timeout of a migration
 * without the marker, or a fifth lock timeout in a row, ends the boot with
 * Prisma's exit code exactly as before. The failure is read from Prisma's
 * own report (`Migration name:` and `Database error code:`), or, on a boot
 * after a failed one (P3009), from the `logs` Prisma stored on the failed
 * row in `_prisma_migrations`.
 *
 * Environment:
 *   HEALTHLOG_PRISMA_CLI      Prisma's CLI entry (default: the image's copy)
 *   HEALTHLOG_MIGRATIONS_DIR  where the migration files are (default:
 *                             prisma/migrations under the working directory)
 *   HEALTHLOG_MIGRATE_LOCK_RETRY_DELAYS
 *                             comma-separated backoff in seconds
 * Arguments are passed through to every Prisma call (`--schema …`).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_RETRY_DELAYS_S = [15, 30, 60, 120, 240];

/** The line a migration carries when a lock-timeout retry is safe for it. */
export const RETRY_MARKER = /^--\s*@retry-on-lock-timeout\s*$/m;

const LOCK_TIMEOUT = "55P03";
const MIGRATION_NAME = /^[A-Za-z0-9_]+$/;

/**
 * The migration a P3018 report says failed on a lock timeout, or null.
 * Prisma prints `Migration name: <name>` and `Database error code: <state>`
 * for a migration that failed to apply.
 */
export function lockTimeoutInReport(text) {
  if (typeof text !== "string") return null;
  const name = /^Migration name: (\S+)\s*$/m.exec(text)?.[1];
  const code = /^Database error code: (\S+)\s*$/m.exec(text)?.[1];
  return name && code === LOCK_TIMEOUT ? name : null;
}

/** Whether Prisma refused to start because a failed migration is on record. */
function isFailedMigrationOnRecord(output) {
  return /\bP3009\b/.test(output);
}

/**
 * Decide whether a failed `migrate deploy` is the one failure retried here.
 *
 * @param {object} input
 * @param {string} input.output    everything Prisma printed
 * @param {Array<{migration_name: string, logs: string | null}> | null} input.failedRows
 *   the unfinished, not-rolled-back rows of `_prisma_migrations`, or null
 *   when they were not read
 * @param {(name: string) => string | null} input.readMigration
 *   the migration's SQL, or null when the image does not ship it
 * @returns {{ retry: true, migration: string } | { retry: false, reason: string }}
 */
export function decideLockRetry({ output, failedRows, readMigration }) {
  let migration = lockTimeoutInReport(output);
  if (!migration && isFailedMigrationOnRecord(output) && failedRows) {
    // More than one failed row is not a state this boot can reason about.
    if (failedRows.length === 1) {
      migration = lockTimeoutInReport(failedRows[0].logs);
    }
  }
  if (!migration) {
    return { retry: false, reason: "not a lock timeout" };
  }
  if (!MIGRATION_NAME.test(migration)) {
    return { retry: false, reason: `unexpected migration name ${migration}` };
  }
  const sql = readMigration(migration);
  if (sql === null) {
    return { retry: false, reason: `${migration} is not in this image` };
  }
  if (!RETRY_MARKER.test(sql)) {
    return {
      retry: false,
      reason: `${migration} timed out on a lock but is not marked safe to re-run`,
    };
  }
  return { retry: true, migration };
}

/** The backoff schedule, from the environment or the default. */
export function retryDelays(raw) {
  if (!raw) return DEFAULT_RETRY_DELAYS_S;
  const delays = raw.split(",").map((part) => Number(part.trim()));
  return delays.every((d) => Number.isFinite(d) && d >= 0)
    ? delays
    : DEFAULT_RETRY_DELAYS_S;
}

function runPrisma(cli, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cli, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", (error) => {
      output += String(error);
      resolve({ code: 1, output });
    });
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}

/** The failed rows of `_prisma_migrations`, or null when they cannot be read. */
async function readFailedRows(connectionString) {
  if (!connectionString) return null;
  try {
    const { default: pg } = await import("pg");
    const url = new URL(connectionString);
    const schema = url.searchParams.get("schema") || "public";
    url.searchParams.delete("schema");
    const client = new pg.Client({
      connectionString: url.toString(),
      connectionTimeoutMillis: 5_000,
      statement_timeout: 5_000,
    });
    await client.connect();
    try {
      const { rows } = await client.query(
        `SELECT migration_name, logs FROM ${client.escapeIdentifier(schema)}._prisma_migrations
         WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
      );
      return rows;
    } finally {
      await client.end().catch(() => {});
    }
  } catch {
    return null;
  }
}

function migrationReader(dir) {
  return (name) => {
    try {
      return readFileSync(join(dir, name, "migration.sql"), "utf8");
    } catch {
      return null;
    }
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main({
  cli = process.env.HEALTHLOG_PRISMA_CLI ||
    "/opt/prisma-cli/node_modules/prisma/build/index.js",
  migrationsDir = process.env.HEALTHLOG_MIGRATIONS_DIR ||
    join(process.cwd(), "prisma", "migrations"),
  delays = retryDelays(process.env.HEALTHLOG_MIGRATE_LOCK_RETRY_DELAYS),
  extraArgs = process.argv.slice(2),
} = {}) {
  const readMigration = migrationReader(migrationsDir);
  for (let attempt = 0; ; attempt++) {
    const deploy = await runPrisma(cli, ["migrate", "deploy", ...extraArgs]);
    if (deploy.code === 0) return 0;

    const failedRows = isFailedMigrationOnRecord(deploy.output)
      ? await readFailedRows(process.env.DATABASE_URL)
      : null;
    const decision = decideLockRetry({
      output: deploy.output,
      failedRows,
      readMigration,
    });
    if (!decision.retry) {
      if (decision.reason !== "not a lock timeout") {
        console.error(
          `HealthLog: not retrying the migration: ${decision.reason}.`,
        );
      }
      return deploy.code;
    }
    if (attempt >= delays.length) {
      console.error(
        `HealthLog: ERROR — migration ${decision.migration} timed out on a lock ` +
          `${attempt + 1} times in a row; giving up. Something holds the table ` +
          "for minutes: see docs/ops/deploy.md, " +
          '"A migration that timed out on a lock".',
      );
      return deploy.code;
    }
    const delay = delays[attempt];
    console.log(
      `HealthLog: migration ${decision.migration} timed out waiting for a lock ` +
        `(55P03) and changed nothing; marking it rolled back and retrying in ` +
        `${delay}s (retry ${attempt + 1} of ${delays.length}).`,
    );
    const resolve = await runPrisma(cli, [
      "migrate",
      "resolve",
      "--rolled-back",
      decision.migration,
      ...extraArgs,
    ]);
    if (resolve.code !== 0) return resolve.code;
    await sleep(delay * 1000);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main();
}
