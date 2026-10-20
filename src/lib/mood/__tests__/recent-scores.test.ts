import { describe, expect, it, vi } from "vitest";

const { moodEntry } = vi.hoisted(() => ({
  moodEntry: { findMany: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: { moodEntry } }));

import { readRecentMoodScores } from "../recent-scores";

describe("readRecentMoodScores", () => {
  it("reads live entries only, newest first, and hands them back oldest first", async () => {
    const newer = {
      date: "2026-10-02",
      score: 4,
      moodLoggedAt: new Date("2026-10-02T08:00:00Z"),
    };
    const older = {
      date: "2026-10-01",
      score: 2,
      moodLoggedAt: new Date("2026-10-01T08:00:00Z"),
    };
    moodEntry.findMany.mockResolvedValueOnce([newer, older]);

    const rows = await readRecentMoodScores("u1", 30);

    expect(moodEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", deletedAt: null },
        orderBy: { moodLoggedAt: "desc" },
        take: 30,
      }),
    );
    expect(rows).toEqual([older, newer]);
  });
});
