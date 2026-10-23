import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/jobs/apple-health-import-worker", () => ({
  reconcileOrphanImportJobs: vi.fn(),
}));
vi.mock("@/lib/jobs/integration-status-null-probe", () => ({
  probeIntegrationStatusNullBuckets: vi.fn(),
}));
vi.mock("@/lib/logging/background", () => ({ withBackgroundEvent: vi.fn() }));
vi.mock("../shared", () => ({ getWorkerPrisma: vi.fn(), workerLog: vi.fn() }));

import {
  registerShutdownHandlers,
  SHUTDOWN_JOB_TIMEOUT_MS,
} from "../worker-lifecycle";

function fakeProcess() {
  const listeners = new Map<string, () => void>();
  const exits: Array<number | string | null | undefined> = [];
  const proc = {
    once: (event: string, fn: () => void) => {
      listeners.set(event, fn);
      return proc;
    },
    exit: (code?: number | string | null) => {
      exits.push(code);
    },
  };
  return {
    proc: proc as unknown as Pick<NodeJS.Process, "once" | "exit">,
    signal: (name: string) => listeners.get(name)?.(),
    exits,
  };
}

describe("graceful shutdown", () => {
  it("holds the process exit until running jobs have finished", async () => {
    let finishJobs!: () => void;
    const stopped = new Promise<void>((r) => (finishJobs = r));
    const stop = vi.fn(() => stopped);
    const fake = fakeProcess();
    registerShutdownHandlers({ stop }, fake.proc);

    fake.signal("SIGTERM");
    expect(stop).toHaveBeenCalledWith({
      graceful: true,
      timeout: SHUTDOWN_JOB_TIMEOUT_MS,
    });
    // Next's handler closes the server and exits; the exit waits.
    fake.proc.exit(143);
    await new Promise((r) => setTimeout(r, 10));
    expect(fake.exits).toEqual([]);

    finishJobs();
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.exits).toEqual([143]);
  });

  it("exits at the deadline when a job does not finish", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeProcess();
      registerShutdownHandlers(
        { stop: vi.fn(() => new Promise<void>(() => {})) },
        fake.proc,
      );
      fake.signal("SIGTERM");
      fake.proc.exit(143);
      await vi.advanceTimersByTimeAsync(SHUTDOWN_JOB_TIMEOUT_MS);
      expect(fake.exits).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fake.exits).toEqual([143]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drains once, whatever signals follow", () => {
    const stop = vi.fn(() => Promise.resolve());
    const fake = fakeProcess();
    registerShutdownHandlers({ stop }, fake.proc);
    fake.signal("SIGTERM");
    fake.signal("SIGINT");
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
