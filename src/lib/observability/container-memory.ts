import { readFileSync } from "node:fs";

import { megabytes } from "@/lib/support/heap-limit";

import type { InFlightRegistry } from "./in-flight";

/**
 * Container memory guard: the process's whole footprint against the cgroup
 * limit, not just the V8 heap.
 *
 * The heap monitor sees the V8 heap only. A large share of this process's
 * memory lives outside it: the GeoLite2 databases read into Buffers, the
 * query compiler's WebAssembly memory, canvas and pdf.js for document
 * thumbnails, zlib streams of a backup. When the cgroup runs out the kernel
 * kills the process with SIGKILL and nothing is logged at all, however calm
 * the heap line looked.
 *
 * Every five seconds (the heap monitor's tick) the guard reads the cgroup's
 * working set: `memory.current` minus the reclaimable `inactive_file` page
 * cache, the figure `docker stats` and the kubelet report. At 85 % of the
 * limit it writes one `runtime.memory.pressure` line at `warn` with the work
 * in flight, re-armed once the working set is back under 70 % and thirty
 * minutes have passed, and raises a flag the heavy job lane reads to send
 * new heavy jobs back to the queue for a minute instead of starting them
 * (`memoryPressureActive`). A pressure that does not ease within fifteen
 * minutes is taken as the container's normal size rather than a peak: the
 * flag drops, so a container sized at its limit is never starved of its
 * nightly jobs, and the pressure line has said so.
 *
 * Outside a cgroup with a limit (a developer machine, a host without one)
 * the guard reads nothing and never raises the flag.
 */

export const CONTAINER_MEMORY_TASK = "runtime.memory.pressure";
export const CONTAINER_PRESSURE_RATIO = 0.85;
export const CONTAINER_REARM_RATIO = 0.7;
export const CONTAINER_PRESSURE_COOLDOWN_MS = 30 * 60_000;
/** How long new heavy jobs are held back before the pressure counts as normal. */
export const CONTAINER_BACKOFF_MAX_MS = 15 * 60_000;

export interface ContainerMemoryReading {
  /** Working set: usage minus reclaimable page cache, bytes. */
  workingSet: number;
  /** The cgroup's limit, bytes. */
  limit: number;
}

const UNLIMITED_BYTES = 1024 ** 4;

function readNumber(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function statField(stat: string, field: string): number {
  const line = stat.split("\n").find((l) => l.startsWith(`${field} `));
  return line ? (readNumber(line.slice(field.length + 1)) ?? 0) : 0;
}

/**
 * The cgroup working set and limit, cgroup v2 first, then v1. `null` when
 * there is no limit or the files cannot be read.
 */
export function readContainerMemory(
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): ContainerMemoryReading | null {
  const layouts = [
    {
      usage: "/sys/fs/cgroup/memory.current",
      limit: "/sys/fs/cgroup/memory.max",
      stat: "/sys/fs/cgroup/memory.stat",
      inactive: "inactive_file",
    },
    {
      usage: "/sys/fs/cgroup/memory/memory.usage_in_bytes",
      limit: "/sys/fs/cgroup/memory/memory.limit_in_bytes",
      stat: "/sys/fs/cgroup/memory/memory.stat",
      inactive: "total_inactive_file",
    },
  ];
  for (const layout of layouts) {
    let usage: number | null;
    let limit: number | null;
    try {
      usage = readNumber(read(layout.usage));
      limit = readNumber(read(layout.limit));
    } catch {
      continue;
    }
    if (usage === null || limit === null) return null;
    if (limit <= 0 || limit >= UNLIMITED_BYTES) return null;
    let inactive = 0;
    try {
      inactive = statField(read(layout.stat), layout.inactive);
    } catch {
      // Without the stat file the usage stands as it is.
    }
    return { workingSet: Math.max(0, usage - inactive), limit };
  }
  return null;
}

const PRESSURE_FLAG = Symbol.for("healthlog.containerMemory.pressure");

type FlagSlot = { [PRESSURE_FLAG]?: boolean };

/**
 * Whether new heavy jobs should wait: the working set is at or above 85 % of
 * the limit and has not stayed there for fifteen minutes yet. Kept on
 * `globalThis` because the lane and the guard can sit in different server
 * bundles of one process.
 */
export function memoryPressureActive(): boolean {
  return (globalThis as FlagSlot)[PRESSURE_FLAG] === true;
}

export interface ContainerMemoryDeps {
  now: () => number;
  read: () => ContainerMemoryReading | null;
  registry: InFlightRegistry;
  emit: (
    taskName: string,
    level: "info" | "warn",
    meta: Record<string, unknown>,
  ) => void;
  /** Extra figures for the line (the heap's). */
  figures: () => Record<string, unknown>;
}

/** The guard's decisions, one `check()` per tick; separate for the tests. */
export class ContainerMemoryGuard {
  private armed = true;
  private lastReportAt: number | null = null;
  private pressureSince: number | null = null;

  constructor(private readonly deps: ContainerMemoryDeps) {}

  /** The latest reading, for the heap line. */
  last: ContainerMemoryReading | null = null;

  check(): void {
    const { now, read } = this.deps;
    const at = now();
    const reading = read();
    this.last = reading;
    const slot = globalThis as FlagSlot;
    if (!reading) {
      slot[PRESSURE_FLAG] = false;
      return;
    }
    const ratio = reading.workingSet / reading.limit;

    if (ratio >= CONTAINER_PRESSURE_RATIO) {
      this.pressureSince ??= at;
      slot[PRESSURE_FLAG] = at - this.pressureSince < CONTAINER_BACKOFF_MAX_MS;
    } else {
      this.pressureSince = null;
      slot[PRESSURE_FLAG] = false;
    }

    if (
      !this.armed &&
      ratio < CONTAINER_REARM_RATIO &&
      this.lastReportAt !== null &&
      at - this.lastReportAt >= CONTAINER_PRESSURE_COOLDOWN_MS
    ) {
      this.armed = true;
    }
    if (this.armed && ratio >= CONTAINER_PRESSURE_RATIO) {
      this.armed = false;
      this.lastReportAt = at;
      const inFlight = this.deps.registry.report(at, 50);
      this.deps.emit(CONTAINER_MEMORY_TASK, "warn", {
        ...this.deps.figures(),
        container_working_set_mb: megabytes(reading.workingSet),
        container_limit_mb: megabytes(reading.limit),
        container_used_ratio: Math.round(ratio * 1000) / 1000,
        pressure_ratio: CONTAINER_PRESSURE_RATIO,
        heavy_jobs_held_back_max_minutes: CONTAINER_BACKOFF_MAX_MS / 60_000,
        in_flight_oldest: inFlight.oldest,
        in_flight_by_route: inFlight.by_route,
      });
    }
  }
}

/** The working set and limit as heap-line fields, or nothing outside a cgroup. */
export function containerMemoryFields(
  reading: ContainerMemoryReading | null,
): Record<string, number> {
  if (!reading) return {};
  return {
    container_working_set_mb: megabytes(reading.workingSet),
    container_limit_mb: megabytes(reading.limit),
  };
}
