/**
 * The boot's `migrate deploy` wrapper (`scripts/migrate-deploy.mjs`): which
 * failures it retries, and the loop it runs around Prisma.
 *
 * The report texts below are what Prisma 7's `migrate deploy` printed against
 * a real Postgres 16 for a migration that hit its `lock_timeout` (P3018), and
 * for the boot after that (P3009). The loop is driven end to end through a
 * stand-in CLI that plays those reports back, so no database is needed here;
 * `tests/integration/migrate-deploy-lock-retry.test.ts` runs the real CLI.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  decideLockRetry,
  lockTimeoutInReport,
  retryDelays,
} from "../migrate-deploy.mjs";

const P3018_LOCK = `Applying migration \`0412_measurement_hot_updates\`
Error: P3018

A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve

Migration name: 0412_measurement_hot_updates

Database error code: 55P03

Database error:
ERROR: canceling statement due to lock timeout
`;

const P3018_UNIQUE = P3018_LOCK.replace("55P03", "23505").replace(
  "canceling statement due to lock timeout",
  'duplicate key value violates unique constraint "x"',
);

const P3009 = `Error: P3009

migrate found failed migrations in the target database, new migrations will not be applied. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve
The \`0412_measurement_hot_updates\` migration started at 2026-10-20 08:38:22.114155 UTC failed
`;

const MARKED = "-- @retry-on-lock-timeout\nDO $$ BEGIN END $$;\n";
const UNMARKED = "ALTER TABLE x ADD COLUMN y int;\n";

const reader =
  (sql: string | null) =>
  (_name: string): string | null =>
    sql;

describe("which failure is retried", () => {
  it("reads the failed migration and its SQLSTATE from Prisma's report", () => {
    expect(lockTimeoutInReport(P3018_LOCK)).toBe(
      "0412_measurement_hot_updates",
    );
    expect(lockTimeoutInReport(P3018_UNIQUE)).toBeNull();
    expect(lockTimeoutInReport(P3009)).toBeNull();
    expect(lockTimeoutInReport(null)).toBeNull();
  });

  it("retries a lock timeout of a migration marked safe to re-run", () => {
    expect(
      decideLockRetry({
        output: P3018_LOCK,
        failedRows: null,
        readMigration: reader(MARKED),
      }),
    ).toEqual({ retry: true, migration: "0412_measurement_hot_updates" });
  });

  it("does not retry a lock timeout of an unmarked migration", () => {
    const decision = decideLockRetry({
      output: P3018_LOCK,
      failedRows: null,
      readMigration: reader(UNMARKED),
    });
    expect(decision.retry).toBe(false);
    expect(decision).toMatchObject({
      reason: expect.stringContaining("not marked safe to re-run"),
    });
  });

  it("does not retry any other database error", () => {
    expect(
      decideLockRetry({
        output: P3018_UNIQUE,
        failedRows: null,
        readMigration: reader(MARKED),
      }),
    ).toEqual({ retry: false, reason: "not a lock timeout" });
  });

  it("does not retry a migration the image does not ship", () => {
    expect(
      decideLockRetry({
        output: P3018_LOCK,
        failedRows: null,
        readMigration: reader(null),
      }).retry,
    ).toBe(false);
  });

  it("on the boot after a failure, reads the cause from the stored row", () => {
    const failedRows = [
      { migration_name: "0412_measurement_hot_updates", logs: P3018_LOCK },
    ];
    expect(
      decideLockRetry({
        output: P3009,
        failedRows,
        readMigration: reader(MARKED),
      }),
    ).toEqual({ retry: true, migration: "0412_measurement_hot_updates" });
    // A stored failure of another kind stays fatal.
    expect(
      decideLockRetry({
        output: P3009,
        failedRows: [{ ...failedRows[0], logs: P3018_UNIQUE }],
        readMigration: reader(MARKED),
      }).retry,
    ).toBe(false);
    // Two failed rows, or rows that could not be read: not a state to guess at.
    expect(
      decideLockRetry({
        output: P3009,
        failedRows: [failedRows[0], failedRows[0]],
        readMigration: reader(MARKED),
      }).retry,
    ).toBe(false);
    expect(
      decideLockRetry({
        output: P3009,
        failedRows: null,
        readMigration: reader(MARKED),
      }).retry,
    ).toBe(false);
  });

  it("refuses a migration name that is not a directory name", () => {
    expect(
      decideLockRetry({
        output: P3018_LOCK.replace(
          "Migration name: 0412_measurement_hot_updates",
          "Migration name: ../../etc",
        ),
        failedRows: null,
        readMigration: reader(MARKED),
      }).retry,
    ).toBe(false);
  });

  it("reads the backoff from the environment and falls back on nonsense", () => {
    expect(retryDelays(undefined)).toEqual([15, 30, 60, 120, 240]);
    expect(retryDelays("0, 1")).toEqual([0, 1]);
    expect(retryDelays("a,1")).toEqual([15, 30, 60, 120, 240]);
  });
});

describe("the retry loop", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  });

  /**
   * A stand-in Prisma CLI: each `migrate deploy` prints the next scripted
   * report and exits with its code; every call is appended to `calls.log`.
   */
  function setup(reports: Array<[number, string]>, sql: string) {
    const dir = mkdtempSync(join(tmpdir(), "hl-migrate-deploy-"));
    dirs.push(dir);
    const migrations = join(dir, "migrations");
    mkdirSync(join(migrations, "0412_measurement_hot_updates"), {
      recursive: true,
    });
    writeFileSync(
      join(migrations, "0412_measurement_hot_updates", "migration.sql"),
      sql,
    );
    writeFileSync(join(dir, "reports.json"), JSON.stringify(reports));
    const cli = join(dir, "fake-prisma.mjs");
    writeFileSync(
      cli,
      `import { appendFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
appendFileSync(dir + "/calls.log", args.join(" ") + "\\n");
if (args[0] === "migrate" && args[1] === "deploy") {
  const n = existsSync(dir + "/n") ? Number(readFileSync(dir + "/n", "utf8")) : 0;
  writeFileSync(dir + "/n", String(n + 1));
  const [code, text] = JSON.parse(readFileSync(dir + "/reports.json", "utf8"))[n];
  process.stderr.write(text);
  process.exit(code);
}
process.exit(0);
`,
    );
    const run = () =>
      spawnSync(
        process.execPath,
        [join(process.cwd(), "scripts/migrate-deploy.mjs"), "--schema", "x"],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            DATABASE_URL: "",
            HEALTHLOG_PRISMA_CLI: cli,
            HEALTHLOG_MIGRATIONS_DIR: migrations,
            HEALTHLOG_MIGRATE_LOCK_RETRY_DELAYS: "0,0",
          },
        },
      );
    const calls = () =>
      existsSync(join(dir, "calls.log"))
        ? readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n")
        : [];
    return { run, calls };
  }

  it("marks the timed-out migration rolled back and deploys again", () => {
    const { run, calls } = setup(
      [
        [1, P3018_LOCK],
        [0, "All migrations have been successfully applied."],
      ],
      MARKED,
    );
    const result = run();
    expect(result.status).toBe(0);
    expect(calls()).toEqual([
      "migrate deploy --schema x",
      "migrate resolve --rolled-back 0412_measurement_hot_updates --schema x",
      "migrate deploy --schema x",
    ]);
    expect(result.stdout).toContain("timed out waiting for a lock (55P03)");
  });

  it("gives up after the last delay with Prisma's exit code", () => {
    const { run, calls } = setup(
      [
        [1, P3018_LOCK],
        [1, P3018_LOCK],
        [1, P3018_LOCK],
      ],
      MARKED,
    );
    const result = run();
    expect(result.status).toBe(1);
    expect(calls().filter((c) => c.startsWith("migrate deploy"))).toHaveLength(
      3,
    );
    expect(calls().filter((c) => c.startsWith("migrate resolve"))).toHaveLength(
      2,
    );
    expect(result.stderr).toContain("giving up");
  });

  it("stops at the first failure that is not a lock timeout", () => {
    const { run, calls } = setup([[1, P3018_UNIQUE]], MARKED);
    const result = run();
    expect(result.status).toBe(1);
    expect(calls()).toEqual(["migrate deploy --schema x"]);
  });

  it("stops at a lock timeout of a migration that is not marked", () => {
    const { run, calls } = setup([[1, P3018_LOCK]], UNMARKED);
    const result = run();
    expect(result.status).toBe(1);
    expect(calls()).toEqual(["migrate deploy --schema x"]);
    expect(result.stderr).toContain("not marked safe to re-run");
  });
});
