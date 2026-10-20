/**
 * The heavy lane runs one heavy job at a time per process. A job that finds
 * the lane taken goes back to its queue at once instead of waiting in the
 * handler, where its expiry would run down while it stood in line.
 */
import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { heavyLane } from "../heavy-lane";
import { jobDone } from "../job-outcome";

type TestJob = Job<{ force?: boolean }>;

function job(id = "j", data: { force?: boolean } = {}): TestJob {
  return { id, data } as unknown as TestJob;
}

/** A handler that runs until `finish` is called, recording the overlap. */
function gate(log: string[], name: string) {
  let finish!: () => void;
  const done = new Promise<void>((r) => (finish = r));
  const handler = vi.fn(async () => {
    log.push(`start:${name}`);
    await done;
    log.push(`end:${name}`);
    return jobDone({ jobs: 1 });
  });
  return { handler, finish };
}

/** A stand-in for the way back to the queue, recording what went back. */
function deferrals() {
  const back: Array<{ queue: string; ids: string[] }> = [];
  const defer = vi.fn(async (queue: string, jobs: readonly TestJob[]) => {
    back.push({ queue, ids: jobs.map((j) => j.id) });
    return jobs.length;
  });
  return { back, defer };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("heavyLane", () => {
  it("sends a heavy job back to its queue while another holds the lane", async () => {
    const log: string[] = [];
    const a = gate(log, "import");
    const b = gate(log, "backup");
    const { back, defer } = deferrals();
    const running = heavyLane(
      "apple-health-import-v2",
      a.handler,
      undefined,
      defer,
    )([job("upload")]);
    await tick();
    const outcome = await heavyLane(
      "data-backup",
      b.handler,
      undefined,
      defer,
    )([job("weekly")]);
    // It returned at once, without running and without waiting.
    expect(outcome).toMatchObject({ ok: true, did: { lane_deferred: 1 } });
    expect(b.handler).not.toHaveBeenCalled();
    expect(back).toEqual([{ queue: "data-backup", ids: ["weekly"] }]);
    a.finish();
    await running;
    // Once the lane is free the redelivered job runs.
    const again = heavyLane(
      "data-backup",
      b.handler,
      undefined,
      defer,
    )([job("weekly")]);
    await tick();
    b.finish();
    await again;
    expect(log).toEqual([
      "start:import",
      "end:import",
      "start:backup",
      "end:backup",
    ]);
    expect(defer).toHaveBeenCalledTimes(1);
  });

  it("lets a light job of a heavy queue pass the lane", async () => {
    const log: string[] = [];
    const a = gate(log, "walk");
    const b = gate(log, "warm");
    const { defer } = deferrals();
    const notForced = (j: TestJob) => !j.data.force;
    const walk = heavyLane(
      "insight-pregenerate",
      a.handler,
      notForced,
      defer,
    )([job()]);
    const warm = heavyLane(
      "insight-pregenerate",
      b.handler,
      notForced,
      defer,
    )([job("w", { force: true })]);
    await tick();
    b.finish();
    a.finish();
    await Promise.all([walk, warm]);
    expect(log.indexOf("start:warm")).toBeLessThan(log.indexOf("end:walk"));
    expect(defer).not.toHaveBeenCalled();
  });

  it("frees the lane when a handler throws", async () => {
    const { defer } = deferrals();
    const failing = heavyLane(
      "rollup-full-backfill",
      async () => {
        throw new Error("boom");
      },
      undefined,
      defer,
    );
    await expect(failing([job()])).rejects.toThrow("boom");
    const next = vi.fn(async () => jobDone({ jobs: 1 }));
    await expect(
      heavyLane("data-backup", next, undefined, defer)([job()]),
    ).resolves.toMatchObject({ ok: true });
    expect(next).toHaveBeenCalledTimes(1);
    expect(defer).not.toHaveBeenCalled();
  });

  it("fails the delivery when the way back to the queue fails", async () => {
    const log: string[] = [];
    const holder = gate(log, "holder");
    const { defer } = deferrals();
    const held = heavyLane(
      "data-backup-offhost",
      holder.handler,
      undefined,
      defer,
    )([job()]);
    await tick();
    const broken = vi.fn(async () => {
      throw new Error("db down");
    });
    // pg-boss then retries it, rather than completing a job that never ran.
    await expect(
      heavyLane("data-backup", vi.fn(), undefined, broken)([job()]),
    ).rejects.toThrow("db down");
    holder.finish();
    await held;
  });

  it("refuses a queue that is not declared heavy", () => {
    expect(() =>
      heavyLane("host-metric-sample", async () => jobDone()),
    ).toThrow(/not in HEAVY_QUEUES/);
  });
});
