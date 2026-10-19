import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  getHeapSpaceStatistics,
  getHeapStatistics,
  writeHeapSnapshot,
} from "node:v8";

import { envFlag, envOr } from "@/lib/env";
import { WideEventBuilder } from "@/lib/logging/event-builder";
import { emitIfSampled } from "@/lib/logging/transports";

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
 *     quiet process, a trend line rather than a flood.
 *   - `runtime.heap.pressure`, at `warn`, the first time the heap reaches 85 %
 *     of its limit: the heap figures plus the oldest requests and jobs in
 *     flight and the routes most of them share (see `in-flight.ts`). It
 *     re-arms only after the heap has fallen back under 70 % AND thirty minutes
 *     have passed, so a heap hovering at the line writes one report, not one
 *     every check.
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
 * `HEALTHLOG_DIAG_DIR` (default `/tmp`), inside a directory only the process
 * user can open, the file chmod 0600. One per process, ever. A snapshot is a
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

function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
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

function defaultEmit(
  taskName: string,
  level: "info" | "warn",
  meta: Record<string, unknown>,
): void {
  const event = new WideEventBuilder("background");
  event.setBackground({ task_name: taskName });
  for (const [key, value] of Object.entries(meta)) event.addMeta(key, value);
  if (level === "warn") event.elevateLevel("warn");
  event.finish();
  emitIfSampled(event.toJSON());
}

/** The opt-in heap snapshot; exported for its file-mode test. */
export function writeDiagnosticHeapSnapshot(): SnapshotOutcome {
  try {
    const dir = join(
      envOr("HEALTHLOG_DIAG_DIR", "/tmp"),
      `healthlog-heap-${process.pid}`,
    );
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
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

    if (this.pressureArmed && ratio >= HEAP_PRESSURE_RATIO) {
      this.pressureArmed = false;
      this.lastPressureAt = at;
      this.lastSampleAt = at;
      this.reportPressure(at);
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

  private reportPressure(at: number): void {
    const { registry, emit, readFigures } = this.deps;
    const inFlight = registry.report(at, HEAP_PRESSURE_LIST_MAX);
    const willSnapshot = this.deps.snapshotEnabled && !this.snapshotTaken;
    // Written before the snapshot: if writing the snapshot is what tips the
    // process over, the report is already on stdout.
    emit(HEAP_TASK_NAMES.pressure, "warn", {
      ...readFigures(),
      pressure_ratio: HEAP_PRESSURE_RATIO,
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
    emit: defaultEmit,
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
