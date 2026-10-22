import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PgBoss } from "pg-boss";

import { markStartup } from "@/lib/boot/startup-state";
import { setGlobalBoss } from "@/lib/jobs/boss-instance";
import {
  BOSS_START_KEY,
  enqueueWhenBossReady,
  whenBossReady,
} from "@/lib/jobs/boss-ready";

const STARTUP_KEY = Symbol.for("healthlog.boot.startupState");

function fakeBoss(): PgBoss {
  return { send: vi.fn(async () => "job-1") } as unknown as PgBoss;
}

beforeEach(() => {
  vi.useFakeTimers();
  setGlobalBoss(null);
  delete (globalThis as Record<symbol, unknown>)[STARTUP_KEY];
  delete (globalThis as Record<string, unknown>)[BOSS_START_KEY];
});

afterEach(() => {
  vi.useRealTimers();
  setGlobalBoss(null);
  delete (globalThis as Record<symbol, unknown>)[STARTUP_KEY];
  delete (globalThis as Record<string, unknown>)[BOSS_START_KEY];
  vi.restoreAllMocks();
});

describe("enqueueWhenBossReady", () => {
  it("sends at once through a bound boss", async () => {
    const boss = fakeBoss();
    setGlobalBoss(boss);
    const send = vi.fn(async (b: PgBoss) => b.send("q", {}));
    await expect(enqueueWhenBossReady("q", send)).resolves.toBe("sent");
    expect(send).toHaveBeenCalledWith(boss);
  });

  it("skips without waiting when no start is under way", async () => {
    const send = vi.fn(async () => undefined);
    await expect(enqueueWhenBossReady("q", send)).resolves.toBe("skipped");
    expect(send).not.toHaveBeenCalled();
  });

  it("sends once the boss is bound when it arrives during boot", async () => {
    markStartup("starting");
    const send = vi.fn(async () => undefined);
    await expect(enqueueWhenBossReady("q", send)).resolves.toBe("deferred");
    expect(send).not.toHaveBeenCalled();

    const boss = fakeBoss();
    setGlobalBoss(boss);
    await vi.advanceTimersByTimeAsync(300);
    expect(send).toHaveBeenCalledWith(boss);
  });

  it("waits for a producer reconnect too", async () => {
    (globalThis as Record<string, unknown>)[BOSS_START_KEY] = Promise.resolve();
    const send = vi.fn(async () => undefined);
    await expect(enqueueWhenBossReady("q", send)).resolves.toBe("deferred");
    setGlobalBoss(fakeBoss());
    await vi.advanceTimersByTimeAsync(300);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("whenBossReady", () => {
  it("gives up after the timeout and says so", async () => {
    markStartup("starting");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = whenBossReady("rollup-recompute", 1_000);
    await vi.advanceTimersByTimeAsync(1_100);
    await expect(pending).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("rollup-recompute was not enqueued"),
    );
  });

  it("stops waiting as soon as the start fails", async () => {
    markStartup("starting");
    const pending = whenBossReady("q", 60_000);
    markStartup("failed");
    await vi.advanceTimersByTimeAsync(300);
    await expect(pending).resolves.toBeNull();
  });
});
