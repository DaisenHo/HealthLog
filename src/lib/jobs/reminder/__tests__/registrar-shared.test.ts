/**
 * The registrar's two boot-time decisions that reach pg-boss on every
 * instance: how often an idle worker polls, and which retired queues are
 * removed.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { $executeRaw: vi.fn().mockResolvedValue(0) },
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));

import { jobDone } from "@/lib/jobs/job-outcome";
import {
  CRON_FED_POLL_SECONDS,
  createAndSchedule,
  createAndWork,
  retireQueues,
} from "../registrar-shared";

function fakeBoss() {
  return {
    createQueue: vi.fn().mockResolvedValue(undefined),
    updateQueue: vi.fn().mockResolvedValue(undefined),
    schedule: vi.fn().mockResolvedValue(undefined),
    work: vi.fn().mockResolvedValue("worker-id"),
    unschedule: vi.fn().mockResolvedValue(undefined),
    deleteQueue: vi.fn().mockResolvedValue(undefined),
  };
}

const handler = async () => jobDone({ jobs: 1 });

function pollOf(boss: ReturnType<typeof fakeBoss>, queue: string) {
  const call = boss.work.mock.calls.find((c) => c[0] === queue);
  return (call?.[1] as { pollingIntervalSeconds?: number })
    .pollingIntervalSeconds;
}

describe("idle polling", () => {
  it("polls slowly on a queue only its cron feeds, at pg-boss's default otherwise", async () => {
    const boss = fakeBoss();
    await createAndSchedule(
      boss as never,
      ["test-cron-only", "pr-detection", "test-send-only"],
      [
        ["test-cron-only", "0 3 * * *"],
        // Scheduled, and sent per account on every ingest.
        ["pr-detection", "*/30 * * * *"],
      ],
    );
    for (const queue of ["test-cron-only", "pr-detection", "test-send-only"]) {
      await createAndWork(
        boss as never,
        queue,
        { localConcurrency: 1 },
        handler,
      );
    }
    expect(pollOf(boss, "test-cron-only")).toBe(CRON_FED_POLL_SECONDS);
    expect(pollOf(boss, "pr-detection")).toBeUndefined();
    expect(pollOf(boss, "test-send-only")).toBeUndefined();
  });

  it("keeps a poll the binding names", async () => {
    const boss = fakeBoss();
    await createAndSchedule(
      boss as never,
      ["test-named-poll"],
      [["test-named-poll", "0 4 * * *"]],
    );
    await createAndWork(
      boss as never,
      "test-named-poll",
      { localConcurrency: 1, pollingIntervalSeconds: 5 },
      handler,
    );
    expect(pollOf(boss, "test-named-poll")).toBe(5);
  });
});

describe("retireQueues", () => {
  it("removes the schedule before the queue, and one failure does not stop the rest", async () => {
    const boss = fakeBoss();
    const order: string[] = [];
    boss.unschedule.mockImplementation(async (name: string) => {
      order.push(`unschedule:${name}`);
    });
    boss.deleteQueue.mockImplementation(async (name: string) => {
      order.push(`delete:${name}`);
      if (name === "old-a") throw new Error("locked");
    });
    await expect(
      retireQueues(boss as never, ["old-a", "old-b"]),
    ).resolves.toBeUndefined();
    expect(order).toEqual([
      "unschedule:old-a",
      "delete:old-a",
      "unschedule:old-b",
      "delete:old-b",
    ]);
  });
});
