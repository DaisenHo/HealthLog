import { chmodSync, lstatSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
  getHeapSpaceStatistics,
  getHeapStatistics,
  writeHeapSnapshot,
} from "node:v8";

import { envFlag, envOr } from "@/lib/env";
import { WideEventBuilder } from "@/lib/logging/event-builder";
import { emitIfSampled } from "@/lib/logging/transports";
import { megabytes } from "@/lib/support/heap-limit";

import { inFlightRegistry, type InFlightRegistry } from "./in-flight";

/**
 * Heap monitor: the line a process writes before it runs out of memory.
 *
 * A Node process that hits its heap limit dies with `JavaScript heap out of
 * memory` and nothing else: no JavaScript stack, no wide event, no record of
 * the requests it was serving. The only memory figures in the log came from
 * `job.progress`, written by jobs that run longer than two minutes. That made
 * a crash impossible to attribute after the fact.
 *
 * Three task names, all background wide events:
 *
 *   - `runtime.heap.sampled`, every five minutes, and every minute while the
 *     heap stands at or above 70 % of its limit. About 290 lines a day on a
 *     quiet process, a trend line rather than a flood. It goes to stdout and
 *     Loki but not into the admin log ring, which it would otherwise flush.
 *   - `runtime.heap.pressure`, at `warn`, the first time the heap reaches 85 %
 *     of its limit: the heap figures plus the oldest requests and jobs in
 *     flight and the routes most of them share (see `in-flight.ts`). It
 *     re-arms only after the heap has fallen back under 70 % AND thirty minutes
 *     have passed, so a heap hovering at the line writes one report, not one
 *     every check. A second tier at 95 % writes the same report with no
 *     cooldown at all, and re-arms as soon as the heap is back under 85 %:
 *     a heap that climbs to its limit within the half hour after an 85 %
 *     report would otherwise die with only that older report on record, the
 *     requests that pushed it over missing from it.
 *   - `runtime.heap.snapshot`, at `warn`, only with the opt-in below: where
 *     the snapshot was written, or that writing it failed.
 *
 * The heap is read every five seconds, which costs one
 * `v8.getHeapStatistics()` call (a few microseconds); the fuller read for an
 * emitted line runs at most once a minute. A pressure climb therefore cannot
 * hide between two minute ticks.
 *
 * Opt-in heap snapshot: with `HEALTHLOG_HEAP_SNAPSHOT=1`, the first pressure
 * report is followed by one `v8.writeHeapSnapshot()` into
 * `HEALTHLOG_DIAG_DIR` (default `/tmp`), inside a fresh randomly named
 * directory only the process user can open, the file chmod 0600. One per process, ever. A snapshot is a
 * copy of the whole heap, decrypted health records and keys included: it is
 * never uploaded, never logged, and only its path is reported. Writing it
 * blocks the process for seconds and needs memory of its own, so it is a tool
 * for chasing one crash, not a setting to leave on. See
 * `docs/ops/heap-diagnostics.md`.
 */

export const HEAP_TASK_NAMES = {
  sampled: "runtime.heap.sampled",
  pressure: "runtime.heap.pressure",
  snapshot: "runtime.heap.snapshot",
} as const;

export const HEAP_CHECK_INTERVAL_MS = 5_000;
export const HEAP_SAMPLE_INTERVAL_MS = 5 * 60_000;
export const HEAP_SAMPLE_INTERVAL_ELEVATED_MS = 60_000;
export const HEAP_ELEVATED_RATIO = 0.7;
export const HEAP_PRESSURE_RATIO = 0.85;
export const HEAP_CRITICAL_RATIO = 0.95;
export const HEAP_PRESSURE_COOLDOWN_MS = 30 * 60_000;
export const HEAP_PRESSURE_LIST_MAX = 50;

export interface HeapFigures {
  heap_used_mb: number;
  heap_total_mb: number;
  heap_limit_mb: number;
  heap_used_ratio: number;
  old_space_mb: number;
  rss_mb: number;
  external_mb: number;
  array_buffers_mb: number;
  active_requests: number;
  active_jobs: number;
  in_flight_dropped: number;
  uptime_s: number;
}

export type SnapshotOutcome =
  | { snapshot: "written"; snapshot_path: string }
  | { snapshot: "failed"; snapshot_error: string };

export interface HeapMonitorDeps {
  now: () => number;
  /** Used heap and limit, in bytes: the five-second check. */
  readHeap: () => { used: number; limit: number };
  /** The full figures for an emitted line. */
  readFigures: () => HeapFigures;
  registry: InFlightRegistry;
  emit: (
    taskName: string,
    level: "info" | "warn",
    meta: Record<string, unknown>,
  ) => void;
  snapshotEnabled: boolean;
  writeSnapshot: () => SnapshotOutcome;
}

function defaultReadHeap(): { used: number; limit: number } {
  const stats = getHeapStatistics();
  return { used: stats.used_heap_size, limit: stats.heap_size_limit };
}

function defaultReadFigures(registry: InFlightRegistry): HeapFigures {
  const memory = process.memoryUsage();
  const limit = getHeapStatistics().heap_size_limit;
  const oldSpace = getHeapSpaceStatistics().find(
    (space) => space.space_name === "old_space",
  );
  const counts = registry.counts();
  return {
    heap_used_mb: megabytes(memory.heapUsed),
    heap_total_mb: megabytes(memory.heapTotal),
    heap_limit_mb: megabytes(limit),
    heap_used_ratio:
      limit > 0 ? Math.round((memory.heapUsed / limit) * 1000) / 1000 : 0,
    old_space_mb: megabytes(oldSpace?.space_used_size ?? 0),
    rss_mb: megabytes(memory.rss),
    external_mb: megabytes(memory.external),
    array_buffers_mb: megabytes(memory.arrayBuffers),
    active_requests: counts.http,
    active_jobs: counts.job,
    in_flight_dropped: registry.dropped,
    uptime_s: Math.round(process.uptime()),
  };
}

/** The production emit; exported for its ring-buffer test. */
export function emitHeapLine(
  taskName: string,
  level: "info" | "warn",
  meta: Record<string, unknown>,
): void {
  const event = new WideEventBuilder("background");
  event.setBackground({ task_name: taskName });
  for (const [key, value] of Object.entries(meta)) event.addMeta(key, value);
  if (level === "warn") event.elevateLevel("warn");
  event.finish();
  // The periodic sample stays out of the admin log ring: at a minute apart
  // under load it would evict the very events someone opens that page for.
  // stdout and Loki still get it; the pressure and snapshot lines (warn) go
  // everywhere.
  emitIfSampled(event.toJSON(), {
    skipMemoryRing: taskName === HEAP_TASK_NAMES.sampled,
  });
}

/**
 * Whether `path` is a real directory (not a symlink) owned by this process's
 * user and closed to everyone else. Checked before a snapshot is written into
 * it, because the snapshot holds decrypted health data.
 */
export function isPrivateDirectory(path: string): boolean {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    return false;
  }
  return (stat.mode & 0o077) === 0;
}

/**
 * The opt-in heap snapshot; exported for its file-mode test.
 *
 * The directory comes from `mkdtempSync`: an unpredictable name created
 * atomically with mode 0700, so nobody can have placed a directory or a
 * symlink there first (a pid-based name is not that: in a container the pid
 * is usually 1). It is re-checked with `lstat` before anything is written.
 */
export function writeDiagnosticHeapSnapshot(): SnapshotOutcome {
  try {
    const dir = mkdtempSync(
      join(envOr("HEALTHLOG_DIAG_DIR", "/tmp"), "healthlog-heap-"),
    );
    if (!isPrivateDirectory(dir)) {
      return { snapshot: "failed", snapshot_error: "unsafe_directory" };
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = writeHeapSnapshot(join(dir, `heap-${stamp}.heapsnapshot`));
    chmodSync(path, 0o600);
    return { snapshot: "written", snapshot_path: path };
  } catch (err) {
    return {
      snapshot: "failed",
      snapshot_error:
        (err as NodeJS.ErrnoException | null)?.code ??
        (err instanceof Error ? err.name : "Unknown"),
    };
  }
}

/**
 * The monitor's decisions, one `check()` per five-second tick. Separate from
 * the timer so the tests drive it with a fake clock and fake readings.
 */
export class HeapMonitor {
  private lastSampleAt: number | null = null;
  private pressureArmed = true;
  private criticalArmed = true;
  private lastPressureAt: number | null = null;
  private snapshotTaken = false;

  constructor(private readonly deps: HeapMonitorDeps) {}

  check(): void {
    const { now, readHeap } = this.deps;
    const at = now();
    const { used, limit } = readHeap();
    const ratio = limit > 0 ? used / limit : 0;

    if (
      !this.pressureArmed &&
      ratio < HEAP_ELEVATED_RATIO &&
      this.lastPressureAt !== null &&
      at - this.lastPressureAt >= HEAP_PRESSURE_COOLDOWN_MS
    ) {
      this.pressureArmed = true;
    }

    if (!this.criticalArmed && ratio < HEAP_PRESSURE_RATIO) {
      this.criticalArmed = true;
    }

    if (this.pressureArmed && ratio >= HEAP_PRESSURE_RATIO) {
      this.pressureArmed = false;
      this.lastPressureAt = at;
      this.lastSampleAt = at;
      // A heap that jumps straight past 95 % gets one report, at the tier
      // it reached.
      const critical = ratio >= HEAP_CRITICAL_RATIO;
      if (critical) this.criticalArmed = false;
      this.reportPressure(
        at,
        critical ? HEAP_CRITICAL_RATIO : HEAP_PRESSURE_RATIO,
      );
      return;
    }

    if (this.criticalArmed && ratio >= HEAP_CRITICAL_RATIO) {
      this.criticalArmed = false;
      this.lastSampleAt = at;
      this.reportPressure(at, HEAP_CRITICAL_RATIO);
      return;
    }

    const interval =
      ratio >= HEAP_ELEVATED_RATIO
        ? HEAP_SAMPLE_INTERVAL_ELEVATED_MS
        : HEAP_SAMPLE_INTERVAL_MS;
    if (this.lastSampleAt === null || at - this.lastSampleAt >= interval) {
      this.lastSampleAt = at;
      this.deps.emit(HEAP_TASK_NAMES.sampled, "info", {
        ...this.deps.readFigures(),
      });
    }
  }

  private reportPressure(at: number, tier: number): void {
    const { registry, emit, readFigures } = this.deps;
    const inFlight = registry.report(at, HEAP_PRESSURE_LIST_MAX);
    const willSnapshot = this.deps.snapshotEnabled && !this.snapshotTaken;
    // Written before the snapshot: if writing the snapshot is what tips the
    // process over, the report is already on stdout.
    emit(HEAP_TASK_NAMES.pressure, "warn", {
      ...readFigures(),
      pressure_ratio: tier,
      in_flight_oldest: inFlight.oldest,
      in_flight_by_route: inFlight.by_route,
      snapshot: willSnapshot ? "pending" : "disabled",
    });
    if (!willSnapshot) return;
    this.snapshotTaken = true;
    emit(HEAP_TASK_NAMES.snapshot, "warn", {
      ...readFigures(),
      ...this.deps.writeSnapshot(),
    });
  }
}

const STARTED = Symbol.for("healthlog.heapMonitor.started");

/**
 * Start the monitor. Idempotent per process, like the event-loop monitor
 * beside it; the timer is unref'd and never holds the process open.
 */
export function startHeapMonitor(overrides: Partial<HeapMonitorDeps> = {}) {
  const slots = globalThis as unknown as { [STARTED]?: boolean };
  if (slots[STARTED]) return;
  slots[STARTED] = true;

  const registry = overrides.registry ?? inFlightRegistry();
  const monitor = new HeapMonitor({
    now: Date.now,
    readHeap: defaultReadHeap,
    readFigures: () => defaultReadFigures(registry),
    registry,
    emit: emitHeapLine,
    snapshotEnabled: envFlag("HEALTHLOG_HEAP_SNAPSHOT"),
    writeSnapshot: writeDiagnosticHeapSnapshot,
    ...overrides,
  });

  const timer = setInterval(() => {
    try {
      monitor.check();
    } catch {
      // A diagnostic must never take the process down.
    }
  }, HEAP_CHECK_INTERVAL_MS);
  timer.unref();
}
