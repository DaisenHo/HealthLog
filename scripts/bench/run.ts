/**
 * Request benchmark against a seeded account: latency (p50, p95, max) and
 * SQL statements per request for the hot read and write paths.
 *
 *   DATABASE_URL=postgresql://… API_TOKEN_HMAC_KEY=… ENCRYPTION_KEYS=… \
 *   ENCRYPTION_ACTIVE_KEY_ID=… pnpm dlx tsx scripts/bench/run.ts \
 *     [--user bench-large] [--iterations 20] [--warmup 3] \
 *     [--base-url http://127.0.0.1:3100] [--out scripts/bench/results/<label>]
 *
 * See docs/contributing/benchmarks.md for the whole setup (a throwaway
 * Postgres with pg_stat_statements, migrations, the seed, a production
 * build). Never point it at a database that holds real data: it mints a
 * token for the bench user and writes measurements under it.
 *
 * Without `--base-url` the script starts the production build itself
 * (`next start` on `.next`) as a web-only process under the production heap
 * ceiling, and stops it at the end.
 *
 * Statements are counted with pg_stat_statements: the sum of `calls` over
 * the database, read before and after each request, once no statement is
 * in flight and the count has stopped moving (so fire-and-forget writes a
 * request starts are counted with it). The bench's own reads of the two
 * views are excluded. Requests run one at a time, so nothing else is in the
 * delta except the server's idle background, which is measured first and
 * reported. Before the measurement the build boots once with every role, so
 * the worker creates its queues as it does in production; whatever that
 * boot scheduled is dropped.
 *
 * Each read runs twice: cold, with the user's caches evicted before every
 * request by a one-row manual-sync ingest (excluded from the numbers), so
 * the request rebuilds what it serves; and warm, back to back, which is
 * what a cache hit costs. The batch ingest posts 5,000 fresh rows as ten
 * requests of 500, the route's per-request limit, and removes them again.
 *
 * Output: `<out>.json` and `<out>.md`. Exit 2 on any non-2xx response.
 */
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { dirname, join } from "node:path";

import { Pool } from "pg";

import { issueApiToken } from "@/lib/auth/issue-token";
import { prisma } from "@/lib/db";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const USER_ID = arg("user", "bench-large");
const ITERATIONS = Number(arg("iterations", "20"));
const WARMUP = Number(arg("warmup", "3"));
const PORT = Number(arg("port", "3100"));
const BASE_URL = arg("base-url", "");
const OUT = arg("out", join("scripts", "bench", "results", "latest"));
const HEAP_MB = Number(arg("heap-mb", "792"));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function statementCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string | null }>(
    `SELECT sum(calls)::bigint AS n FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
        AND query NOT ILIKE '%pg_stat_statements%'
        AND query NOT ILIKE '%pg_stat_activity%'`,
  );
  return Number(rows[0]?.n ?? 0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until the server has no statement in flight and the counter holds
 * still for 150 ms (or 10 s pass), then read it. pg_stat_statements counts a
 * statement when it ends, so a long fold in a background refresh would look
 * settled by the counter alone; pg_stat_activity says it is still running.
 */
async function settledCount(): Promise<number> {
  let last = -1;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ active: string }>(
      `SELECT count(*)::int AS active FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
          AND state NOT IN ('idle')`,
    );
    const now = await statementCount();
    if (Number(rows[0]?.active ?? 0) === 0 && now === last) return now;
    last = now;
    await sleep(150);
  }
  return last;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, i))]!;
}

interface Sample {
  ms: number;
  statements: number;
  status: number;
}

interface ScenarioResult {
  name: string;
  mode: "cold" | "warm" | "write";
  request: string;
  n: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  statementsMedian: number;
  statementsMax: number;
  failures: number;
}

let token = "";
const failures: string[] = [];

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<Sample> {
  const before = await settledCount();
  const started = performance.now();
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  await res.arrayBuffer();
  const ms = performance.now() - started;
  const after = await settledCount();
  if (!res.ok) failures.push(`${method} ${path}: ${res.status}`);
  return { ms, statements: after - before, status: res.status };
}

function summarise(
  name: string,
  mode: ScenarioResult["mode"],
  request: string,
  samples: Sample[],
): ScenarioResult {
  const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
  const st = samples.map((s) => s.statements).sort((a, b) => a - b);
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    name,
    mode,
    request,
    n: samples.length,
    p50Ms: r(percentile(ms, 50)),
    p95Ms: r(percentile(ms, 95)),
    maxMs: r(ms[ms.length - 1] ?? 0),
    statementsMedian: percentile(st, 50),
    statementsMax: st[st.length - 1] ?? 0,
    failures: samples.filter((s) => s.status >= 300).length,
  };
}

/**
 * The per-user rate limits would refuse a benchmark long before a person
 * meets them (one run sends several hundred requests in minutes), so the
 * bench user's buckets are cleared before each scenario. The limiter's own
 * cost stays in every count.
 */
async function resetRateLimits(): Promise<void> {
  await pool.query(`DELETE FROM rate_limits WHERE key LIKE '%:' || $1`, [
    USER_ID,
  ]);
}

let bustCounter = 0;
/**
 * Evict the user's caches with a real change, outside the numbers: a one-row
 * ingest marked as a manual sync, which hard-evicts instead of marking
 * stale, so the next read is a miss and rebuilds in the request.
 */
async function bust(anchorDay: string): Promise<void> {
  bustCounter += 1;
  const res = await fetch(`${base()}/api/measurements/batch`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      syncTrigger: "manual",
      entries: [
        {
          hkIdentifier: "HKQuantityTypeIdentifierFlightsClimbed",
          value: 10 + (bustCounter % 2),
          unit: "count",
          startDate: `${anchorDay}T08:00:00.000Z`,
          endDate: `${anchorDay}T18:00:00.000Z`,
          externalId: `stats:HKQuantityTypeIdentifierFlightsClimbed:${anchorDay}`,
        },
      ],
    }),
  });
  const body = (await res.json()) as {
    data?: { inserted?: number; updated?: number };
  };
  // A bust that wrote nothing evicted nothing, and every "cold" number
  // after it would be a cache hit.
  if ((body.data?.inserted ?? 0) + (body.data?.updated ?? 0) !== 1) {
    throw new Error(`cache bust wrote no row: ${JSON.stringify(body)}`);
  }
}

function base(): string {
  return BASE_URL || `http://127.0.0.1:${PORT}`;
}

async function waitForHealth(
  timeoutMs: number,
  server: ChildProcess | null,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(`the server exited with code ${server.exitCode}`);
    }
    try {
      const res = await fetch(`${base()}/api/health`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error(`server at ${base()} did not answer /api/health`);
}

function startServer(role: "web" | "all"): ChildProcess {
  // `next start` rather than the standalone server: the standalone tree
  // lacks the externalised runtime packages the image installs separately
  // (see the Dockerfile), while the checkout has them. It serves the same
  // build output.
  const child = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      String(PORT),
      "-H",
      "127.0.0.1",
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        HOSTNAME: "127.0.0.1",
        HEALTHLOG_PROCESS_TYPE: role,
        SESSION_COOKIE_SECURE: "false",
        NODE_OPTIONS: `--max-old-space-size=${HEAP_MB}`,
      },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  return child;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(20_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function freshBatch(run: string, chunk: number): unknown[] {
  // 500 heart-rate readings a minute apart, on a day inside the seeded
  // window, with ids no earlier run used.
  const day = Date.UTC(2026, 0, 1) + chunk * 86_400_000;
  return Array.from({ length: 500 }, (_, i) => {
    const at = new Date(day + i * 60_000).toISOString();
    return {
      hkIdentifier: "HKQuantityTypeIdentifierHeartRate",
      value: 55 + (i % 40),
      unit: "count/min",
      startDate: at,
      endDate: at,
      externalId: `bench-${run}-${chunk}-${i}`,
    };
  });
}

function markdown(meta: Record<string, unknown>, rows: ScenarioResult[]) {
  const lines = [
    `# Benchmark ${String(meta.label)}`,
    "",
    `Commit ${String(meta.commit)}, ${String(meta.date)}. ${String(meta.measurements)} measurement rows on the bench account, ${ITERATIONS} measured requests per row after ${WARMUP} warm-up requests, one at a time. Server: production build, web process, heap ceiling ${HEAP_MB} MB. Postgres ${String(meta.postgres)}, ${String(meta.cpus)} cores, load average ${String(meta.loadAverage)} at the end. Idle background: ${String(meta.idleStatementsPerSecond)} statements/s.`,
    "",
    "| Request | Mode | n | p50 ms | p95 ms | max ms | statements (median) | statements (max) |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (r) =>
        `| ${r.name} | ${r.mode} | ${r.n} | ${r.p50Ms} | ${r.p95Ms} | ${r.maxMs} | ${r.statementsMedian} | ${r.statementsMax} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  await pool.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  await statementCount(); // fails here when the library is not preloaded

  const user = await prisma.user.findUnique({
    where: { id: USER_ID },
    select: { id: true },
  });
  if (!user) throw new Error(`no user ${USER_ID}; run the seed first`);
  const measurements = await prisma.measurement.count({
    where: { userId: USER_ID },
  });
  token = (
    await issueApiToken({
      userId: USER_ID,
      name: "benchmark",
      permissions: ["*"],
      expiresInDays: 1,
    })
  ).token;

  // A web-only process only sends jobs; the queues are created by the
  // worker role. Boot the full process once so every queue exists (as it
  // does in production), then run the measurement against a web-only
  // process, so the worker's polling is not in every delta.
  if (!BASE_URL) {
    const full = startServer("all");
    await waitForHealth(180_000, full);
    await stopServer(full);
    // Drop whatever that boot scheduled: nothing in the web-only process
    // runs jobs, and a fold left queued would change the fixture on the
    // next full boot.
    await pool.query("TRUNCATE pgboss.job");
  }
  const server = BASE_URL ? null : startServer("web");
  try {
    await waitForHealth(180_000, server);

    const idleBefore = await settledCount();
    await sleep(5_000);
    const idleStatementsPerSecond =
      Math.round(((await statementCount()) - idleBefore) / 0.5) / 10;

    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const reads: Array<[string, string]> = [
      ["/api/auth/me", "/api/auth/me"],
      ["dashboard summary", "/api/dashboard/summary"],
      ["dashboard snapshot", "/api/dashboard/snapshot"],
      ["series pulse 30 d", "/api/measurements/series?kind=pulse&days=30"],
      ["series pulse 365 d", "/api/measurements/series?kind=pulse&days=365"],
      ["series pulse 3650 d", "/api/measurements/series?kind=pulse&days=3650"],
      ["day view", `/api/day/${yesterday}`],
      ["insights health status", "/api/insights/health-status"],
      ["insights correlations", "/api/insights/correlations"],
    ];

    const results: ScenarioResult[] = [];
    for (const [name, path] of reads) {
      await resetRateLimits();
      for (let i = 0; i < WARMUP; i++) await call("GET", path);
      const cold: Sample[] = [];
      for (let i = 0; i < ITERATIONS; i++) {
        await bust(yesterday);
        cold.push(await call("GET", path));
      }
      results.push(summarise(name, "cold", `GET ${path}`, cold));
      await resetRateLimits();
      const warm: Sample[] = [];
      for (let i = 0; i < ITERATIONS; i++) warm.push(await call("GET", path));
      results.push(summarise(name, "warm", `GET ${path}`, warm));
      console.log(
        `${name.padEnd(26)} cold p95 ${results.at(-2)!.p95Ms} ms / ${results.at(-2)!.statementsMedian} st, warm p95 ${results.at(-1)!.p95Ms} ms / ${results.at(-1)!.statementsMedian} st`,
      );
    }

    // Rows an earlier run wrote would turn this run's inserts into
    // reconciles of the same natural key, so they go first, and again at
    // the end, leaving the seeded fixture as it was.
    const clean = () =>
      pool.query(
        `DELETE FROM measurements WHERE user_id = $1 AND external_id LIKE 'bench-%'`,
        [USER_ID],
      );
    await clean();
    await resetRateLimits();
    const run = Date.now().toString(36);
    const writes: Sample[] = [];
    for (let chunk = 0; chunk < 10; chunk++) {
      writes.push(
        await call("POST", "/api/measurements/batch", {
          entries: freshBatch(run, chunk),
        }),
      );
    }
    const batch = summarise(
      "batch ingest 5k (per 500)",
      "write",
      "POST /api/measurements/batch ×10",
      writes,
    );
    results.push(batch);
    await clean();
    const totalMs = writes.reduce((a, s) => a + s.ms, 0);
    const totalStatements = writes.reduce((a, s) => a + s.statements, 0);
    console.log(
      `batch ingest 5k             total ${Math.round(totalMs)} ms / ${totalStatements} st`,
    );

    let commit = "unknown";
    try {
      commit = execSync("git rev-parse --short HEAD").toString().trim();
    } catch {
      // not a checkout
    }
    const meta = {
      label: OUT.split("/").pop(),
      commit,
      date: new Date().toISOString(),
      node: process.version,
      postgres: (
        await pool.query<{ v: string }>(
          "SELECT current_setting('server_version') AS v",
        )
      ).rows[0]?.v,
      cpus: cpus().length,
      loadAverage: loadavg().map((n) => Math.round(n * 10) / 10),
      measurements,
      iterations: ITERATIONS,
      warmup: WARMUP,
      heapMb: HEAP_MB,
      idleStatementsPerSecond,
      batch5k: { totalMs: Math.round(totalMs), totalStatements },
    };
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(
      `${OUT}.json`,
      `${JSON.stringify({ meta, results }, null, 2)}\n`,
    );
    writeFileSync(`${OUT}.md`, markdown(meta, results));
    console.log(`wrote ${OUT}.json and ${OUT}.md`);
  } finally {
    if (server) await stopServer(server);
  }

  if (failures.length > 0) {
    console.error(`non-2xx responses:\n  ${failures.join("\n  ")}`);
    process.exitCode = 2;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
