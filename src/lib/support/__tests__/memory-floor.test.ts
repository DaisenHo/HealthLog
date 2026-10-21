import { describe, expect, it, vi } from "vitest";
import {
  containerMemoryLimitMb,
  isBelowMemoryFloor,
  logMemoryFloorAtBoot,
  MEMORY_FLOOR_MB,
  parseCgroupMemoryLimit,
} from "@/lib/support/heap-limit";

const MiB = 1024 * 1024;

describe("memory floor", () => {
  it("is the compose default", () => {
    expect(MEMORY_FLOOR_MB).toBe(1536);
  });

  it("parses cgroup limit files", () => {
    expect(parseCgroupMemoryLimit(`${1536 * MiB}\n`)).toBe(1536);
    expect(parseCgroupMemoryLimit(`${1024 * MiB}`)).toBe(1024);
    expect(parseCgroupMemoryLimit("max\n")).toBeNull();
    // cgroup v1 reports "no limit" as a huge page-aligned sentinel.
    expect(parseCgroupMemoryLimit("9223372036854771712")).toBeNull();
    expect(parseCgroupMemoryLimit("")).toBeNull();
    expect(parseCgroupMemoryLimit("garbage")).toBeNull();
    expect(parseCgroupMemoryLimit("0")).toBeNull();
  });

  it("reads cgroup v2 first, then v1, and gives null without either", () => {
    const files: Record<string, string> = {
      "/sys/fs/cgroup/memory/memory.limit_in_bytes": `${1024 * MiB}`,
    };
    const read = (path: string) => {
      if (path in files) return files[path];
      throw new Error("ENOENT");
    };
    expect(containerMemoryLimitMb(read)).toBe(1024);
    files["/sys/fs/cgroup/memory.max"] = `${2048 * MiB}`;
    expect(containerMemoryLimitMb(read)).toBe(2048);
    files["/sys/fs/cgroup/memory.max"] = "max";
    expect(containerMemoryLimitMb(read)).toBeNull();
    expect(
      containerMemoryLimitMb(() => {
        throw new Error("ENOENT");
      }),
    ).toBeNull();
  });

  it("flags only a known limit under the floor", () => {
    expect(isBelowMemoryFloor(1024)).toBe(true);
    expect(isBelowMemoryFloor(1535)).toBe(true);
    expect(isBelowMemoryFloor(1536)).toBe(false);
    expect(isBelowMemoryFloor(4096)).toBe(false);
    expect(isBelowMemoryFloor(null)).toBe(false);
  });

  it("logs exactly one line at boot below the floor, none otherwise", () => {
    const warn = vi.fn();
    expect(logMemoryFloorAtBoot(1024, warn)).toBe(1024);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(
      /^\[boot\] The container memory limit of 1024 MB is below the supported floor of 1536 MB\./,
    );
    expect(warn.mock.calls[0][0]).not.toContain("\n");
    warn.mockClear();
    logMemoryFloorAtBoot(1536, warn);
    logMemoryFloorAtBoot(null, warn);
    expect(warn).not.toHaveBeenCalled();
  });
});
