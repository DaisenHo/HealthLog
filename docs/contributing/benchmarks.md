# Benchmarks

Two tools measure the server's read and write paths. Use them before and after any change to a hot path, and put both numbers in the PR.

- **`scripts/bench/run.ts`** measures latency (p50, p95, max) and SQL statements per request against a seeded account of about 1.26 million measurement rows, through the production build. It is a local tool, not a CI gate: latency depends on the machine.
- **`tests/integration/query-budget-hot-routes.test.ts`** holds a statement budget per hot route on a small fixture. Statement counts are exact on a fixed fixture, so this one is a gate: a change that adds a query per row, or a second read of something already loaded, fails it.

## The large-account benchmark

### 1. A throwaway Postgres with pg_stat_statements

Never point the seed or the benchmark at a database that holds real data. They write under a synthetic user, and the seed's `--reset` deletes that user with everything it owns.

```sh
docker run -d --name hl-bench-db --shm-size=256m \
  -e POSTGRES_USER=bench -e POSTGRES_PASSWORD=bench -e POSTGRES_DB=healthlog_bench \
  -p 55432:5432 postgres:16.15-alpine \
  postgres -c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=top
```

The image and the two settings are the ones `docker-compose.yml` runs in production.

### 2. Environment, migrations, seed

```sh
export DATABASE_URL="postgresql://bench:bench@127.0.0.1:55432/healthlog_bench?schema=public"
export ENCRYPTION_KEYS='{"v1":"<64 hex>"}' ENCRYPTION_ACTIVE_KEY_ID=v1
export API_TOKEN_HMAC_KEY="<64 hex>"

pnpm db:migrate:deploy
pnpm dlx tsx scripts/bench/seed-large-account.ts --reset --anchor 2026-10-22
```

Any throwaway key values work, as long as the seed, the benchmark and the server see the same ones.

The seed writes ten years for one user: Apple Health dense rows (heart rate about every ten minutes, HRV, SpO2, respiratory rate, gait, audio), Withings blood pressure, pulse and scale, a weekly manual weight, three years of Oura resting heart rate and RMSSD, 90 days of Nightscout CGM, `stats:` and per-sample cumulative rows, nightly sleep stages, about 3,000 workouts, three years of mood and of three medications with their intake events. It then folds the rollup tier the way the boot backfill does and runs `ANALYZE`. It takes about 80 seconds on the Mac mini.

The seed is deterministic for a given `--anchor`: values and timestamps are functions of the row index and that day. Without `--anchor` it anchors on today, which is what you want when the benchmark should see recent data.

### 3. A production build

```sh
pnpm build
```

### 4. Run

```sh
pnpm dlx tsx scripts/bench/run.ts --out scripts/bench/results/<label>
```

The script boots the build once with every role, so the worker creates its queues as it does in production, drops whatever that boot scheduled, and then runs the measurement against a web-only process (`HEALTHLOG_PROCESS_TYPE=web`) under the production heap ceiling (`--max-old-space-size=792`, the value Node derives in the 1.5 GB production container). Without the worker, its polling does not land in every statement count. It prints the server's idle statement rate so the remaining background is visible.

For each route it sends three warm-up requests, then twenty measured ones in each of two modes, one request at a time:

- **cold**: before every request a one-row ingest marked as a manual sync evicts the user's caches, so the request rebuilds what it serves. This is a reader's first look after a sync.
- **warm**: back to back, what a cache hit costs.

The batch ingest posts 5,000 fresh heart-rate rows as ten requests of 500, the route's per-request limit, and removes them again at the end.

Statements are the change in `sum(calls)` of `pg_stat_statements` over the database, read before and after each request, once no statement is in flight and the counter holds still. Fire-and-forget writes a request starts are therefore counted with it.

Options: `--iterations`, `--warmup`, `--user`, `--heap-mb`, `--port`, and `--base-url` to measure a server you started yourself.

The output is `<label>.json` (every number, plus the commit, Node and Postgres versions and the row count) and `<label>.md` (the table). Commit the pair when a change is meant to move a number, so the PR shows before and after.

### Reading the numbers

Run on a quiet machine; a parallel build or test run moves latency by tens of percent and leaves the statement counts alone. Compare statement counts across machines, latency only across runs on the same machine. A local number is only valid under the production heap ceiling, which the script sets.

## Statement budgets in the integration suite

`tests/integration/query-budget-hot-routes.test.ts` seeds a small account (four months of the main types with overlapping sources, sleep, glucose, a medication, workouts and mood), and counts the statements of one request per hot route on a cache miss: `/api/auth/me`, the dashboard summary and snapshot, the pulse series over 30, 365 and 3650 days, the day view, insights health status, correlations, and a 500-row batch ingest.

The counter (`tests/integration/query-counter.ts`) wraps `pg`'s `Client.prototype.query` on the copy of `pg` the Prisma adapter loads, and settles background tasks before it closes the window.

Each budget is the measured count. When a change lowers one, lower the budget in the same change. When a change has to raise one, raise it with the reason in the PR. A failure prints every statement the request sent, grouped by text, so an added loop shows up as one statement with a count next to it.

Run it like any integration file:

```sh
pnpm test:integration tests/integration/query-budget-hot-routes.test.ts
```
