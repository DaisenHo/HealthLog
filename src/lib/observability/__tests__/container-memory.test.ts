import { describe, expect, it } from "vitest";

import { InFlightRegistry } from "../in-flight";
import {
  CONTAINER_BACKOFF_MAX_MS,
  CONTAINER_MEMORY_TASK,
  ContainerMemoryGuard,
  memoryPressureActive,
  readContainerMemory,
  type ContainerMemoryReading,
} from "../container-memory";

const MB = 1024 * 1024;

function files(map: Record<string, string>) {
  return (path: string) => {
    if (!(path in map)) throw new Error(`ENOENT ${path}`);
    return map[path]!;
  };
}

describe("readContainerMemory", () => {
  it("reads cgroup v2 and subtracts the reclaimable page cache", () => {
    const reading = readContainerMemory(
      files({
        "/sys/fs/cgroup/memory.current": `${900 * MB}\n`,
        "/sys/fs/cgroup/memory.max": `${1536 * MB}\n`,
        "/sys/fs/cgroup/memory.stat": `anon 1\ninactive_file ${100 * MB}\nactive_file 5\n`,
      }),
    );
    expect(reading).toEqual({ workingSet: 800 * MB, limit: 1536 * MB });
  });

  it("falls back to cgroup v1", () => {
    const reading = readContainerMemory(
      files({
        "/sys/fs/cgroup/memory/memory.usage_in_bytes": `${500 * MB}`,
        "/sys/fs/cgroup/memory/memory.limit_in_bytes": `${1024 * MB}`,
        "/sys/fs/cgroup/memory/memory.stat": `total_inactive_file ${20 * MB}`,
      }),
    );
    expect(reading).toEqual({ workingSet: 480 * MB, limit: 1024 * MB });
  });

  it("reads nothing without a limit or outside a cgroup", () => {
    expect(
      readContainerMemory(
        files({
          "/sys/fs/cgroup/memory.current": "123",
          "/sys/fs/cgroup/memory.max": "max",
        }),
      ),
    ).toBeNull();
    expect(readContainerMemory(files({}))).toBeNull();
  });
});

describe("ContainerMemoryGuard", () => {
  function guard(readings: Array<ContainerMemoryReading | null>) {
    let at = 0;
    let i = 0;
    const lines: Array<{ task: string; meta: Record<string, unknown> }> = [];
    const g = new ContainerMemoryGuard({
      now: () => at,
      read: () => readings[Math.min(i++, readings.length - 1)] ?? null,
      registry: new InFlightRegistry(),
      emit: (task, _level, meta) => lines.push({ task, meta }),
      figures: () => ({ heap_used_mb: 1 }),
    });
    return {
      tick: (ms = 5_000) => {
        at += ms;
        g.check();
      },
      lines,
    };
  }
  const reading = (ratio: number) => ({
    workingSet: Math.round(ratio * 1000 * MB),
    limit: 1000 * MB,
  });

  it("reports once at 85 % and holds heavy jobs back while it lasts", () => {
    const g = guard([reading(0.5), reading(0.9), reading(0.9), reading(0.6)]);
    g.tick();
    expect(memoryPressureActive()).toBe(false);
    g.tick();
    expect(memoryPressureActive()).toBe(true);
    expect(g.lines).toHaveLength(1);
    expect(g.lines[0]!.task).toBe(CONTAINER_MEMORY_TASK);
    expect(g.lines[0]!.meta).toMatchObject({
      container_working_set_mb: 900,
      container_limit_mb: 1000,
      heap_used_mb: 1,
    });
    g.tick();
    expect(g.lines).toHaveLength(1);
    g.tick();
    expect(memoryPressureActive()).toBe(false);
  });

  it("lets heavy jobs through once the pressure has lasted fifteen minutes", () => {
    const g = guard([reading(0.9)]);
    g.tick();
    expect(memoryPressureActive()).toBe(true);
    g.tick(CONTAINER_BACKOFF_MAX_MS);
    expect(memoryPressureActive()).toBe(false);
  });

  it("never raises the flag outside a cgroup", () => {
    const g = guard([null]);
    g.tick();
    expect(memoryPressureActive()).toBe(false);
    expect(g.lines).toHaveLength(0);
  });
});
