import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, annotate } = vi.hoisted(() => ({
  findMany: vi.fn(),
  annotate: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { measurement: { findMany } } }));
vi.mock("@/lib/logging/context", () => ({ annotate }));

import { readRecentReadings, RECENT_READINGS } from "../recent-readings";

const now = new Date("2026-10-20T12:00:00Z");
const minutesAgo = (n: number) => new Date(now.getTime() - n * 60_000);

beforeEach(() => {
  findMany.mockReset();
  annotate.mockReset();
});

describe("readRecentReadings", () => {
  it("keeps the latest 365 when they reach back 30 days", async () => {
    // One a day: 365 readings span a year.
    const rows = Array.from({ length: RECENT_READINGS }, (_, i) => ({
      value: 70,
      measuredAt: minutesAgo(i * 1440),
    }));
    findMany.mockResolvedValueOnce(rows);
    const out = await readRecentReadings("u1", "PULSE", now);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(out[0].measuredAt < out[out.length - 1].measuredAt).toBe(true);
  });

  it("reads the last 30 days by time when 365 readings are a few hours", async () => {
    const dense = Array.from({ length: RECENT_READINGS }, (_, i) => ({
      value: 70,
      measuredAt: minutesAgo(i),
    }));
    const month = Array.from({ length: 30 * 24 }, (_, i) => ({
      value: 70,
      measuredAt: minutesAgo(i * 60),
    }));
    findMany.mockResolvedValueOnce(dense).mockResolvedValueOnce(month);
    const out = await readRecentReadings("u1", "PULSE", now);
    expect(findMany).toHaveBeenCalledTimes(2);
    const window = findMany.mock.calls[1][0] as {
      where: { measuredAt: { gte: Date }; deletedAt: null };
    };
    expect(window.where.deletedAt).toBeNull();
    expect(window.where.measuredAt.gte.toISOString()).toBe(
      "2026-09-20T12:00:00.000Z",
    );
    expect(out).toHaveLength(month.length);
    expect(annotate).not.toHaveBeenCalled();
  });

  it("keeps fewer than 365 readings whole", async () => {
    findMany.mockResolvedValueOnce([{ value: 1, measuredAt: minutesAgo(5) }]);
    expect(await readRecentReadings("u1", "PULSE", now)).toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
