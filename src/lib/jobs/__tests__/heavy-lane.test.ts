/**
 * The heavy lane runs one heavy job at a time per process, first come first
 * served; a waiter pg-boss expired leaves the line, a one-shot keeps its place.
 */
import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";

vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));

import { heavyLane } from "../heavy-lane";
import { jobDone } from "../job-outcome";

type TestJob = Job<{ force?: boolean }>;

function job(data: { force?: boolean } = {}, signal?: AbortSignal): TestJob {
  return { id: "j", data, signal } as unknown as TestJob;
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

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("heavyLane", () => {
  it("runs two heavy jobs of different queues one after the other", async () => {
    const log: string[] = [];
    const a = gate(log, "backup");
    const b = gate(log, "import");
    const first = heavyLane("data-backup", a.handler)([job()]);
    const second = heavyLane("apple-health-import-v2", b.handler)([job()]);
    await tick();
    expect(log).toEqual(["start:backup"]);
    a.finish();
    await first;
    await tick();
    expect(log).toEqual(["start:backup", "end:backup", "start:import"]);
    b.finish();
    await second;
  });

  it("lets a light job of a heavy queue pass the line", async () => {
    const log: string[] = [];
    const a = gate(log, "walk");
    const b = gate(log, "warm");
    const notForced = (j: TestJob) => !j.data.force;
    const walk = heavyLane(
      "insight-pregenerate",
      a.handler,
      notForced,
    )([job()]);
    const warm = heavyLane(
      "insight-pregenerate",
      b.handler,
      notForced,
    )([job({ force: true })]);
    await tick();
    b.finish();
    a.finish();
    await Promise.all([walk, warm]);
    // The warm started while the walk held the lane.
    expect(log.indexOf("start:warm")).toBeLessThan(log.indexOf("end:walk"));
  });

  it("drops a waiter pg-boss expired, and keeps a one-shot past its expiry", async () => {
    const log: string[] = [];
    const holder = gate(log, "holder");
    const pass = gate(log, "pass");
    const upload = gate(log, "upload");
    const held = heavyLane("data-backup-offhost", holder.handler)([job()]);
    const expiry = new AbortController();
    const waitingPass = heavyLane(
      "data-backup",
      pass.handler,
    )([job({}, expiry.signal)]);
    const uploadExpiry = new AbortController();
    const waitingUpload = heavyLane(
      "apple-health-import-v2",
      upload.handler,
    )([job({}, uploadExpiry.signal)]);
    await tick();
    expiry.abort();
    uploadExpiry.abort();
    const outcome = await waitingPass;
    expect(outcome).toMatchObject({ ok: true, did: { lane_expired: 1 } });
    expect(pass.handler).not.toHaveBeenCalled();
    holder.finish();
    await held;
    await tick();
    expect(log).toEqual(["start:holder", "end:holder", "start:upload"]);
    upload.finish();
    await waitingUpload;
  });

  it("frees the lane when a handler throws", async () => {
    const failing = heavyLane("rollup-full-backfill", async () => {
      throw new Error("boom");
    });
    await expect(failing([job()])).rejects.toThrow("boom");
    const next = vi.fn(async () => jobDone({ jobs: 1 }));
    await expect(
      heavyLane("data-backup", next)([job()]),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses a queue that is not declared heavy", () => {
    expect(() =>
      heavyLane("host-metric-sample", async () => jobDone()),
    ).toThrow(/not in HEAVY_QUEUES/);
  });
});
