/**
 * The two Dawarich movement channels: hours away from home and kilometres
 * travelled, one point per stored day that has the value. A day without it is
 * no coverage and gets no point, never a zero.
 */
import { describe, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { dawarichDay: { findMany } } }));

import { fetchMovementSeries } from "@/lib/insights/correlation-channel-series";
import { metricFamily } from "@/lib/insights/correlation-discovery";

describe("fetchMovementSeries", () => {
  it("emits a point only where the day has the value", async () => {
    findMany.mockResolvedValue([
      { date: "2026-06-14", awayFromHomeMinutes: 90, totalDistanceM: null },
      { date: "2026-06-15", awayFromHomeMinutes: null, totalDistanceM: 48_300 },
    ]);
    const [away, distance] = await fetchMovementSeries(
      "u1",
      "Europe/Berlin",
      new Date("2026-06-01T12:00:00Z"),
    );
    expect(away).toMatchObject({
      key: "MOVEMENT_AWAY",
      role: "behaviour",
      points: [{ day: "2026-06-14", value: 1.5 }],
    });
    expect(distance).toMatchObject({
      key: "MOVEMENT_DISTANCE",
      role: "behaviour",
      points: [{ day: "2026-06-15", value: 48.3 }],
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      userId: "u1",
      date: { gte: "2026-06-01" },
    });
  });

  it("keeps the two channels in one family so they never pair with each other", () => {
    expect(metricFamily("MOVEMENT_AWAY")).toBe(
      metricFamily("MOVEMENT_DISTANCE"),
    );
    expect(metricFamily("MOVEMENT_AWAY")).not.toBe(metricFamily("MOOD"));
  });
});
