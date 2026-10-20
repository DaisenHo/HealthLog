import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  clearLogBuffer,
  getLogBufferSize,
  readLogBuffer,
} from "@/lib/logging/in-memory-buffer";

import { walkSourceFiles } from "@/__tests__/helpers/source-files";

import {
  HEAP_CHECK_INTERVAL_MS,
  HEAP_CRITICAL_RATIO,
  HEAP_PRESSURE_COOLDOWN_MS,
  HEAP_PRESSURE_RATIO,
  HEAP_PRESSURE_LIST_MAX,
  HEAP_SAMPLE_INTERVAL_ELEVATED_MS,
  HEAP_SAMPLE_INTERVAL_MS,
  HEAP_TASK_NAMES,
  HeapMonitor,
  type HeapFigures,
  type HeapMonitorDeps,
  emitHeapLine,
  isPrivateDirectory,
  writeDiagnosticHeapSnapshot,
} from "../heap-monitor";
import { InFlightRegistry } from "../in-flight";

const LIMIT = 1000;

const FIGURE_KEYS: Array<keyof HeapFigures> = [
  "heap_used_mb",
  "heap_total_mb",
  "heap_limit_mb",
  "heap_used_ratio",
  "old_space_mb",
  "rss_mb",
  "external_mb",
  "array_buffers_mb",
  "active_requests",
  "active_jobs",
  "in_flight_dropped",
  "uptime_s",
];

function harness(overrides: Partial<HeapMonitorDeps> = {}) {
  const state = { now: 0, used: 100 };
  const emitted: Array<{
    task: string;
    level: string;
    meta: Record<string, unknown>;
  }> = [];
  let snapshots = 0;
  const registry = new InFlightRegistry();
  const figures = (): HeapFigures =>
    Object.fromEntries(
      FIGURE_KEYS.map((k) => [k, 1]),
    ) as unknown as HeapFigures;
  const monitor = new HeapMonitor({
    now: () => state.now,
    readHeap: () => ({ used: state.used, limit: LIMIT }),
    readFigures: figures,
    registry,
    emit: (task, level, meta) => emitted.push({ task, level, meta }),
    snapshotEnabled: false,
    writeSnapshot: () => {
      snapshots++;
      return { snapshot: "written", snapshot_path: "/diag/x.heapsnapshot" };
    },
    ...overrides,
  });
  /** Advance in five-second checks for `ms`. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += HEAP_CHECK_INTERVAL_MS) {
      monitor.check();
      state.now += HEAP_CHECK_INTERVAL_MS;
    }
  };
  const named = (task: string) => emitted.filter((e) => e.task === task);
  return {
    state,
    emitted,
    named,
    run,
    registry,
    snapshots: () => snapshots,
  };
}

describe("heap monitor sampling", () => {
  it("samples every five minutes under 70 % and every minute above", () => {
    const h = harness();
    h.run(30 * 60_000);
    expect(h.named(HEAP_TASK_NAMES.sampled)).toHaveLength(
      (30 * 60_000) / HEAP_SAMPLE_INTERVAL_MS,
    );

    const elevated = harness();
    elevated.state.used = 750;
    elevated.run(10 * 60_000);
    expect(elevated.named(HEAP_TASK_NAMES.sampled)).toHaveLength(
      (10 * 60_000) / HEAP_SAMPLE_INTERVAL_ELEVATED_MS,
    );
  });

  it("carries a fixed meta shape at info", () => {
    const h = harness();
    h.run(HEAP_CHECK_INTERVAL_MS);
    const [line] = h.named(HEAP_TASK_NAMES.sampled);
    expect(line.level).toBe("info");
    expect(Object.keys(line.meta).sort()).toEqual([...FIGURE_KEYS].sort());
  });
});

describe("heap pressure report", () => {
  it("fires once at 85 % with the work in flight, at warn", () => {
    const h = harness();
    for (let i = 0; i < 80; i++) {
      h.registry.begin({
        kind: "http",
        method: "POST",
        target: "/",
        startedAt: i,
      });
    }
    h.state.used = 900;
    h.run(20 * 60_000);
    const pressure = h.named(HEAP_TASK_NAMES.pressure);
    expect(pressure).toHaveLength(1);
    expect(pressure[0].level).toBe("warn");
    expect(pressure[0].meta.snapshot).toBe("disabled");
    expect(pressure[0].meta.in_flight_oldest).toHaveLength(
      HEAP_PRESSURE_LIST_MAX,
    );
    expect(pressure[0].meta.in_flight_by_route).toEqual([
      { kind: "http", route: "/", count: 80 },
    ]);
    for (const key of FIGURE_KEYS) expect(pressure[0].meta).toHaveProperty(key);
  });

  it("stays quiet while the heap hovers, and re-arms only after it fell back and the cooldown passed", () => {
    const h = harness();
    h.state.used = 900;
    h.run(60_000);
    // Falls back, but the cooldown has not passed.
    h.state.used = 500;
    h.run(60_000);
    h.state.used = 900;
    h.run(60_000);
    expect(h.named(HEAP_TASK_NAMES.pressure)).toHaveLength(1);

    // Stays above 70 % past the cooldown: still armed off.
    h.state.used = 800;
    h.run(HEAP_PRESSURE_COOLDOWN_MS);
    h.state.used = 900;
    h.run(60_000);
    expect(h.named(HEAP_TASK_NAMES.pressure)).toHaveLength(1);

    // Falls under 70 % after the cooldown: armed again.
    h.state.used = 500;
    h.run(HEAP_CHECK_INTERVAL_MS);
    h.state.used = 900;
    h.run(HEAP_CHECK_INTERVAL_MS);
    expect(h.named(HEAP_TASK_NAMES.pressure)).toHaveLength(2);
  });

  it("reports again at 95 % inside the cooldown, once per climb", () => {
    const h = harness();
    h.state.used = 900;
    h.run(60_000);
    // Ten minutes later, well inside the cooldown, the heap nears its limit.
    h.state.used = 800;
    h.run(10 * 60_000);
    h.state.used = 960;
    h.run(60_000);
    const pressure = h.named(HEAP_TASK_NAMES.pressure);
    expect(pressure.map((p) => p.meta.pressure_ratio)).toEqual([
      HEAP_PRESSURE_RATIO,
      HEAP_CRITICAL_RATIO,
    ]);
    expect(pressure[1].meta).toHaveProperty("in_flight_oldest");

    // Hovering at 95 % writes nothing more; back under 85 % re-arms it.
    h.run(5 * 60_000);
    expect(h.named(HEAP_TASK_NAMES.pressure)).toHaveLength(2);
    h.state.used = 840;
    h.run(HEAP_CHECK_INTERVAL_MS);
    h.state.used = 970;
    h.run(HEAP_CHECK_INTERVAL_MS);
    expect(h.named(HEAP_TASK_NAMES.pressure)).toHaveLength(3);
  });

  it("writes one report at the tier a sudden jump reaches", () => {
    const h = harness();
    h.state.used = 990;
    h.run(60_000);
    const pressure = h.named(HEAP_TASK_NAMES.pressure);
    expect(pressure).toHaveLength(1);
    expect(pressure[0].meta.pressure_ratio).toBe(HEAP_CRITICAL_RATIO);
  });

  it("writes no snapshot unless opted in, and at most one when it is", () => {
    const off = harness();
    off.state.used = 900;
    off.run(60_000);
    expect(off.snapshots()).toBe(0);
    expect(off.named(HEAP_TASK_NAMES.snapshot)).toHaveLength(0);

    const on = harness({ snapshotEnabled: true });
    for (let round = 0; round < 3; round++) {
      on.state.used = 900;
      on.run(60_000);
      on.state.used = 100;
      on.run(HEAP_PRESSURE_COOLDOWN_MS + HEAP_CHECK_INTERVAL_MS);
    }
    expect(on.named(HEAP_TASK_NAMES.pressure)).toHaveLength(3);
    expect(on.snapshots()).toBe(1);
    const [line] = on.named(HEAP_TASK_NAMES.snapshot);
    expect(line.meta.snapshot_path).toBe("/diag/x.heapsnapshot");
    // The report is written before the snapshot is taken.
    const order = on.emitted
      .filter((e) => e.task !== HEAP_TASK_NAMES.sampled)
      .map((e) => e.task);
    expect(order.slice(0, 2)).toEqual([
      HEAP_TASK_NAMES.pressure,
      HEAP_TASK_NAMES.snapshot,
    ]);
  });
});

describe("runtime.heap task names", () => {
  it("every runtime.heap.* literal in src is a registered task name", () => {
    const registered = new Set<string>(Object.values(HEAP_TASK_NAMES));
    const found = new Set<string>();
    const src = join(process.cwd(), "src");
    for (const file of walkSourceFiles(src, { floor: 1000 })) {
      if (file.includes("__tests__") || file.startsWith("generated/")) continue;
      const text = readFileSync(join(src, file), "utf8");
      for (const match of text.matchAll(/["'`](runtime\.heap\.[a-z_.]+)["'`]/g))
        found.add(match[1]);
    }
    // A sweep that matches nothing agrees with any register.
    expect(found.size).toBeGreaterThan(0);
    for (const name of found) expect(registered).toContain(name);
    for (const name of registered) expect(found).toContain(name);
  });
});

describe("default snapshot writer", () => {
  it("writes into a fresh random 0700 directory, the file 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-heap-test-"));
    const previous = process.env.HEALTHLOG_DIAG_DIR;
    process.env.HEALTHLOG_DIAG_DIR = dir;
    try {
      const outcome = writeDiagnosticHeapSnapshot();
      expect(outcome.snapshot).toBe("written");
      if (outcome.snapshot !== "written") return;
      const [sub] = readdirSync(dir);
      expect(sub).toMatch(/^healthlog-heap-/);
      // Not derived from the pid, which is 1 in most containers.
      expect(sub).not.toBe(`healthlog-heap-${process.pid}`);
      expect(statSync(join(dir, sub)).mode & 0o777).toBe(0o700);
      expect(statSync(outcome.snapshot_path).mode & 0o777).toBe(0o600);
      expect(outcome.snapshot_path.startsWith(join(dir, sub) + "/")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.HEALTHLOG_DIAG_DIR;
      else process.env.HEALTHLOG_DIAG_DIR = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  }, 90_000);

  it("accepts only a real directory of its own user closed to others", () => {
    const dir = mkdtempSync(join(tmpdir(), "hl-heap-dir-"));
    try {
      const own = join(dir, "own");
      mkdirSync(own, { mode: 0o700 });
      chmodSync(own, 0o700);
      expect(isPrivateDirectory(own)).toBe(true);

      const open = join(dir, "open");
      mkdirSync(open);
      chmodSync(open, 0o755);
      expect(isPrivateDirectory(open)).toBe(false);

      // A symlink to a private directory is still refused: lstat, not stat.
      const link = join(dir, "link");
      symlinkSync(own, link);
      expect(isPrivateDirectory(link)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("admin log ring", () => {
  it("keeps periodic samples out, and pressure reports in", () => {
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    try {
      clearLogBuffer();
      for (let i = 0; i < 20; i++) {
        emitHeapLine(HEAP_TASK_NAMES.sampled, "info", { heap_used_mb: i });
      }
      // The samples still reach stdout.
      expect(write).toHaveBeenCalledTimes(20);
      expect(getLogBufferSize("all")).toBe(0);

      emitHeapLine(HEAP_TASK_NAMES.pressure, "warn", { heap_used_mb: 900 });
      expect(getLogBufferSize("all")).toBe(1);
      expect(getLogBufferSize("problems")).toBe(1);
      const [event] = readLogBuffer({ ring: "problems" });
      expect(event.background?.task_name).toBe(HEAP_TASK_NAMES.pressure);
    } finally {
      write.mockRestore();
      clearLogBuffer();
    }
  });
});
