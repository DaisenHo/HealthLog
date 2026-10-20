/**
 * The registrar's boot-time decisions that reach pg-boss on every instance.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { $executeRaw: vi.fn().mockResolvedValue(0) },
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));

import { retireQueues } from "../registrar-shared";

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
