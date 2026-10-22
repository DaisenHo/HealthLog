/**
 * Whether this process's heap is below what a long-used account needs.
 *
 * Node sizes its heap from the container's memory limit: the 1 GB limit older
 * compose files set gives 524 MB, the current default of 1536m gives 792 MB.
 * At 524 MB a long-used account fills the heap in normal operation, garbage
 * collection stalls requests, and a large import can run the process out of
 * memory, which restarts the whole instance. The support report and the admin
 * system status say so in one sentence, because the number alone ("Heap
 * limit: 524 MB") reads as a fact rather than as the cause (#1239).
 */
import { readFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";

/** Below this, the heap is flagged. Between the 1g (524) and 1536m (792) heaps. */
export const LOW_HEAP_LIMIT_MB = 700;

/** Bytes as whole megabytes (MiB), the unit every heap figure is shown in. */
export function megabytes(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

/** V8's heap limit for this process, in megabytes. */
export function heapLimitMb(): number {
  return megabytes(getHeapStatistics().heap_size_limit);
}

export function isHeapLimitLow(limitMb: number): boolean {
  return limitMb < LOW_HEAP_LIMIT_MB;
}

/** The support report's sentence for a low heap limit. */
export function lowHeapLimitAdvice(limitMb: number): string {
  return (
    `The heap limit of ${limitMb} MB is below ${LOW_HEAP_LIMIT_MB} MB. The ` +
    "usual cause is a 1 GB container memory limit. A long-used account can " +
    "fill this heap, which slows requests and can restart the app. Set " +
    "APP_MEMORY_LIMIT=1536m in .env (about 792 MB of heap) and run " +
    "docker compose up -d."
  );
}

/**
 * The smallest container memory limit HealthLog supports: the compose
 * default. Below it the heap is too small for a long-used account and a
 * large import, so the boot log, the support report and Admin > System
 * status say the host runs below the supported floor. The app keeps
 * running; the floor is advice, not a gate.
 */
export const MEMORY_FLOOR_MB = 1536;

/**
 * The cgroup files that hold a container's memory limit: cgroup v2 first,
 * then v1. A v1 host without a limit reports a huge sentinel value rather
 * than "max", so anything at or above 1 TiB counts as unlimited.
 */
const CGROUP_LIMIT_FILES = [
  "/sys/fs/cgroup/memory.max",
  "/sys/fs/cgroup/memory/memory.limit_in_bytes",
] as const;
const UNLIMITED_BYTES = 1024 ** 4;

/** Parse one cgroup limit file's content; `null` for no limit or garbage. */
export function parseCgroupMemoryLimit(raw: string): number | null {
  const text = raw.trim();
  if (text === "" || text === "max") return null;
  if (!/^\d+$/.test(text)) return null;
  const bytes = Number(text);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes >= UNLIMITED_BYTES) {
    return null;
  }
  return megabytes(bytes);
}

/**
 * This process's container memory limit in megabytes, or `null` when there
 * is none or it cannot be read (no cgroup, not Linux, unlimited).
 */
export function containerMemoryLimitMb(
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): number | null {
  for (const file of CGROUP_LIMIT_FILES) {
    let raw: string;
    try {
      raw = read(file);
    } catch {
      continue;
    }
    return parseCgroupMemoryLimit(raw);
  }
  return null;
}

/** Whether a known container limit is below the supported floor. */
export function isBelowMemoryFloor(limitMb: number | null): boolean {
  return limitMb !== null && limitMb < MEMORY_FLOOR_MB;
}

/** The sentence the boot log and the support report use for it. */
export function memoryFloorAdvice(limitMb: number): string {
  return (
    `The container memory limit of ${limitMb} MB is below the supported ` +
    `floor of ${MEMORY_FLOOR_MB} MB. HealthLog keeps running, but a ` +
    "long-used account or a large import can fill the heap and restart " +
    `the app. Set APP_MEMORY_LIMIT=${MEMORY_FLOOR_MB}m or more in .env and ` +
    "run docker compose up -d; the host needs 3 GB of RAM, 4 GB recommended."
  );
}

/**
 * Log one line at boot when the container runs below the floor. Never
 * throws. Returns the limit it found, for tests.
 */
export function logMemoryFloorAtBoot(
  limitMb: number | null = containerMemoryLimitMb(),
  warn: (line: string) => void = console.warn,
): number | null {
  if (isBelowMemoryFloor(limitMb)) {
    warn(`[boot] ${memoryFloorAdvice(limitMb as number)}`);
  }
  return limitMb;
}
