import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => "job-1"));
vi.mock("@/lib/jobs/boss-instance", () => ({
  getGlobalBoss: () => ({ send }),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("../recompute", () => ({
  recomputeSupplementNutrientsForUser: vi.fn(),
}));

import { recomputeSupplementsIfNutrientsTurnedOn } from "../recompute-job";

beforeEach(() => send.mockClear());

describe("the supplement recompute after a module switch", () => {
  it("queues the full recompute when nutrients comes back on", async () => {
    await recomputeSupplementsIfNutrientsTurnedOn(
      "user-1",
      { nutrients: false },
      { nutrients: true },
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1]).toMatchObject({ userId: "user-1" });
  });

  it("queues nothing when the switch did not move to on", async () => {
    await recomputeSupplementsIfNutrientsTurnedOn(
      "user-1",
      { nutrients: true },
      { nutrients: true, mood: false },
    );
    await recomputeSupplementsIfNutrientsTurnedOn(
      "user-1",
      { nutrients: true },
      { nutrients: false },
    );
    expect(send).not.toHaveBeenCalled();
  });
});
