/**
 * Boot and idle-memory profile of the production build.
 *
 *   DATABASE_URL=postgresql://… API_TOKEN_HMAC_KEY=… ENCRYPTION_KEYS=… \
 *   ENCRYPTION_ACTIVE_KEY_ID=… pnpm dlx tsx scripts/bench/boot-profile.ts \
 *     [--idle-seconds 300] [--heap-mb 792] [--port 3101] \
 *     [--no-snapshot] [--no-cpu-prof] [--out scripts/bench/results/<label>-boot]
 *
 * Starts `next start` with every role (web and worker, as production runs it)
 * under the production heap ceiling, against the seeded benchmark database
 * (see docs/contributing/benchmarks.md; never a database with real data: a
 * heap snapshot holds whatever the process decrypted). It records:
 *
 *   - the time to the first healthy `/api/health` and to `[boot] background
 *     role ready`;
 *   - every `event_loop_stall` the process logs, with the task it names;
 *   - every `runtime.heap.sampled` line;
 *   - with `--cpu-prof` (default on), the busy stretches of the main thread
 *     over 100 ms during the boot, each with its self time by source module;
 *   - with a snapshot (default on), one heap snapshot after the idle wait
 *     (taken with `--heapsnapshot-signal`, so after a full GC: the live heap),
 *     summarised by node type, constructor, largest strings and the largest
 *     retained subtrees with a retaining path.
 *
 * The raw `.cpuprofile` and `.heapsnapshot` are written to a temporary
 * directory and deleted after the summary unless `--keep` is given.
 *
 * The worker's boot passes fold the seeded account while it idles; reseed
 * before running `run.ts` again.
 *
 * Output: `<out>.json` and `<out>.md`.
 */
import { execFileSync, spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { longTasks, selfTimeByModule, summariseHeap } from "./profile-analyze";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const IDLE_SECONDS = Number(arg("idle-seconds", "300"));
const HEAP_MB = Number(arg("heap-mb", "792"));
const PORT = Number(arg("port", "3101"));
const OUT = arg("out", join("scripts", "bench", "results", "latest-boot"));
const SNAPSHOT = !flag("no-snapshot");
const CPU_PROF = !flag("no-cpu-prof");
const KEEP = flag("keep");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function find(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const rec = obj as Record<string, unknown>;
  if (key in rec) return rec[key];
  for (const v of Object.values(rec)) {
    const hit = find(v, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const work = mkdtempSync(join(tmpdir(), "hl-boot-profile-"));
  const nodeOptions = [
    `--max-old-space-size=${HEAP_MB}`,
    ...(CPU_PROF ? ["--cpu-prof", `--cpu-prof-dir=${work}`] : []),
    ...(SNAPSHOT ? ["--heapsnapshot-signal=SIGUSR2"] : []),
  ].join(" ");
  const started = Date.now();
  const child = spawn(
    process.execPath,
    [
      // One line per collection; the mark-compacts say how much of the used
      // heap was live and how much was garbage waiting for a full GC. Not
      // allowed in NODE_OPTIONS, and `next start` serves in this process.
      "--trace-gc",
      "node_modules/next/dist/bin/next",
      "start",
      "-p",
      String(PORT),
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        HOSTNAME: "127.0.0.1",
        HEALTHLOG_PROCESS_TYPE: "all",
        SESSION_COOKIE_SECURE: "false",
        NODE_OPTIONS: nodeOptions,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  // Node writes the snapshot into the process's cwd.
  const snapshotDir = process.cwd();

  const stalls: Array<Record<string, unknown>> = [];
  const heapLines: Array<Record<string, unknown>> = [];
  const bootLines: string[] = [];
  const markCompacts: Array<{
    atMs: number;
    beforeMb: number;
    afterMb: number;
  }> = [];
  let readyAtMs: number | null = null;
  let snapshotTaken = false;
  let buffer = "";
  const onLine = (line: string) => {
    const gc =
      /Mark-Compact(?: \(reduce\))? ([\d.]+) \([\d.]+\) -> ([\d.]+) \(/.exec(
        line,
      );
    if (gc) {
      markCompacts.push({
        atMs: Date.now() - started,
        beforeMb: Number(gc[1]),
        afterMb: Number(gc[2]),
      });
      return;
    }
    if (line.includes("[boot]")) {
      bootLines.push(`${Date.now() - started} ms: ${line.slice(0, 200)}`);
      if (line.includes("background role ready"))
        readyAtMs = Date.now() - started;
    }
    if (!line.startsWith("{")) return;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const task = find(evt, "task_name");
      if (task === "startup" && readyAtMs === null) {
        readyAtMs = Date.now() - started;
      }
      if (task === "event_loop_stall") {
        // The snapshot itself blocks the process for seconds.
        if (snapshotTaken) return;
        stalls.push({
          atMs: Date.now() - started,
          ...(find(evt, "result") as object),
        });
      } else if (task === "runtime.heap.sampled") {
        heapLines.push({
          atMs: Date.now() - started,
          ...((find(evt, "meta") as object) ?? {}),
        });
      } else if (typeof task === "string" && task.startsWith("boot.")) {
        bootLines.push(
          `${Date.now() - started} ms: ${task} ${JSON.stringify(find(evt, "meta") ?? {})}`.slice(
            0,
            400,
          ),
        );
      }
    } catch {
      // not a wide event
    }
  };
  child.stdout!.on("data", (d: Buffer) => {
    buffer += d.toString();
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      onLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  });
  child.stderr!.on("data", (d: Buffer) => {
    for (const line of d.toString().split("\n"))
      if (line.includes("[boot]")) onLine(line);
  });

  let healthyAtMs: number | null = null;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline && healthyAtMs === null) {
    if (child.exitCode !== null)
      throw new Error(`server exited ${child.exitCode}`);
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
      if (res.status < 500 || res.status === 503) {
        const body = await res.text();
        if (res.ok || body.includes("starting"))
          healthyAtMs = Date.now() - started;
      }
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  while (readyAtMs === null && Date.now() < deadline) await sleep(200);
  console.log(
    `health ${healthyAtMs} ms, worker ready ${readyAtMs} ms; idling ${IDLE_SECONDS} s`,
  );
  await sleep(IDLE_SECONDS * 1000);

  let heap: ReturnType<typeof summariseHeap> | null = null;
  if (SNAPSHOT) {
    const before = new Set(readdirSync(snapshotDir));
    snapshotTaken = true;
    child.kill("SIGUSR2");
    let file = "";
    let lastSize = -1;
    for (let i = 0; i < 600; i++) {
      await sleep(1000);
      const f = readdirSync(snapshotDir).find(
        (n) => n.endsWith(".heapsnapshot") && !before.has(n),
      );
      if (!f) continue;
      const size = statSync(join(snapshotDir, f)).size;
      if (size === lastSize && size > 0) {
        file = join(snapshotDir, f);
        break;
      }
      lastSize = size;
    }
    if (file) {
      // A snapshot is finished when the process answers again.
      await fetch(`http://127.0.0.1:${PORT}/api/health`).catch(() => undefined);
      const moved = join(work, "idle.heapsnapshot");
      renameSync(file, moved);
      console.log("summarising heap snapshot");
      heap = summariseHeap(moved, {
        "parsed locale catalogs": ["common", "apiErrors", "doctorReport"],
      });
    }
  }

  const exited = new Promise((r) => child.once("exit", r));
  child.kill("SIGTERM");
  await Promise.race([exited, sleep(60_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");

  let tasks: ReturnType<typeof longTasks> = [];
  let bootSelf: Array<[string, number]> = [];
  if (CPU_PROF) {
    await sleep(1000);
    const profiles = readdirSync(work).filter((n) => n.endsWith(".cpuprofile"));
    // The largest profile is the server process (`next start` may run a
    // small parent).
    const main = profiles
      .map((n) => join(work, n))
      .sort((a, b) => statSync(b).size - statSync(a).size)[0];
    if (main) {
      const profile = JSON.parse(readFileSync(main, "utf8"));
      tasks = longTasks(profile, 50, 0.5).filter((t) => t.startMs < 120_000);
      bootSelf = selfTimeByModule(
        profile,
        0,
        (readyAtMs ?? 30_000) + 5_000,
      ).slice(0, 40);
    }
  }
  if (!KEEP) rmSync(work, { recursive: true, force: true });
  else console.log(`raw files kept in ${work}`);

  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"])
      .toString()
      .trim();
  } catch {
    // not a checkout
  }
  const meta = {
    label: OUT.split("/").pop(),
    commit,
    date: new Date().toISOString(),
    node: process.version,
    cpus: cpus().length,
    loadAverage: loadavg().map((n) => Math.round(n * 10) / 10),
    heapMb: HEAP_MB,
    idleSeconds: IDLE_SECONDS,
    healthyAtMs,
    readyAtMs,
    stallMaxMs: Math.max(0, ...stalls.map((s) => Number(s.lag_ms ?? 0))),
  };
  mkdirSync(dirname(OUT), { recursive: true });
  // Paths in frame and retainer names are made relative to the checkout,
  // before anything shortens them.
  const relative = (text: string) => text.split(`${process.cwd()}/`).join("");
  if (heap) heap = JSON.parse(relative(JSON.stringify(heap))) as typeof heap;
  tasks = JSON.parse(relative(JSON.stringify(tasks))) as typeof tasks;
  writeFileSync(
    `${OUT}.json`,
    relative(
      `${JSON.stringify({ meta, bootLines, stalls, heapLines, markCompacts, tasks, bootSelf, heap }, null, 2)}\n`,
    ),
  );
  const md: string[] = [
    `# Boot profile ${String(meta.label)}`,
    "",
    `Commit ${commit}, ${meta.date}. Production build, every role, heap ceiling ${HEAP_MB} MB, ${IDLE_SECONDS} s idle. ${meta.cpus} cores, load average ${meta.loadAverage.join(",")} at the end.`,
    "",
    `- first answer from /api/health: ${healthyAtMs} ms; background role ready: ${readyAtMs} ms`,
    `- event-loop stalls logged: ${stalls.length}, max ${meta.stallMaxMs} ms`,
    "",
    "## Stalls",
    "",
    ...stalls.map((s) => `- ${JSON.stringify(s)}`),
    "",
    "## Heap samples",
    "",
    "| at s | used MB | old | large obj | code | external | array buffers | rss |",
    "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...heapLines.map(
      (h) =>
        `| ${Math.round(Number(h.atMs) / 1000)} | ${h.heap_used_mb} | ${h.old_space_mb} | ${h.large_object_space_mb} | ${h.code_space_mb} | ${h.external_mb} | ${h.array_buffers_mb} | ${h.rss_mb} |`,
    ),
    "",
    "## Full collections (mark-compact)",
    "",
    `${markCompacts.length} mark-compacts during the run. Used heap before the collection, and what survived it (the live heap):`,
    "",
    "| at s | before MB | after MB |",
    "| ---: | ---: | ---: |",
    ...markCompacts
      .filter(
        (m, i, all) =>
          i === all.length - 1 || i % Math.ceil(all.length / 15) === 0,
      )
      .map(
        (m) =>
          `| ${Math.round(m.atMs / 1000)} | ${m.beforeMb} | ${m.afterMb} |`,
      ),
    "",
    "## Main-thread busy stretches over 50 ms without an idle sample, first two minutes",
    "",
    ...tasks.flatMap((t) => [
      `### at ${t.startMs} ms, ${t.durationMs} ms`,
      "",
      "| self time by module | ms |",
      "| --- | ---: |",
      ...t.byModule.slice(0, 10).map(([m, v]) => `| ${m} | ${v} |`),
      "",
      "| inclusive, application modules | ms |",
      "| --- | ---: |",
      ...t.byEntry.slice(0, 10).map(([m, v]) => `| ${m} | ${v} |`),
      "",
    ]),
    "## Self time by module until the worker is ready",
    "",
    "| module | ms |",
    "| --- | ---: |",
    ...bootSelf.slice(0, 25).map(([m, v]) => `| ${m} | ${v} |`),
    "",
  ];
  if (heap) {
    md.push(
      `## Heap snapshot after ${IDLE_SECONDS} s idle (live heap after a full GC)`,
      "",
      `${heap.totalMb} MB in ${heap.nodeCount} nodes; module source strings over 50 KB: ${heap.sourceStringsMb} MB.`,
      "",
      ...Object.entries(heap.probes).map(
        ([k, v]) => `- ${k}: ${v.count} objects, ${v.retainedMb} MB retained`,
      ),
      "",
      "| node type | MB |",
      "| --- | ---: |",
      ...heap.byType.map(([k, v]) => `| ${k} | ${v} |`),
      "",
      "| constructor | MB | count |",
      "| --- | ---: | ---: |",
      ...heap.byConstructor
        .slice(0, 20)
        .map(([k, v, c]) => `| ${k.replace(/\|/g, "/")} | ${v} | ${c} |`),
      "",
      "| largest retained subtrees | MB | retaining path |",
      "| --- | ---: | --- |",
      ...heap.topRetainers
        .slice(0, 30)
        .map(
          (r) =>
            `| ${r.name.replace(/\|/g, "/")} | ${r.mb} | ${r.path.replace(/\|/g, "/").slice(0, 160)} |`,
        ),
      "",
      "| largest strings | MB |",
      "| --- | ---: |",
      ...heap.largestStrings
        .slice(0, 15)
        .map(([s, t]) => `| ${t.replace(/\|/g, "/").slice(0, 90)} | ${s} |`),
      "",
    );
  }
  writeFileSync(`${OUT}.md`, relative(md.join("\n")));
  console.log(`wrote ${OUT}.json and ${OUT}.md`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
