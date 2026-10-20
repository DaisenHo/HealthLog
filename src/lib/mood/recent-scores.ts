/**
 * The recent-mood context read shared by the per-metric status snapshots
 * (pulse, weight, blood pressure, general). A deleted entry is a tombstone
 * kept for sync and undo; it must never reach a model prompt or a summary,
 * so the filter lives here rather than at each call site.
 */
import { prisma } from "@/lib/db";

export interface RecentMoodScore {
  date: string;
  score: number;
  moodLoggedAt: Date;
}

/** Most recent `take` live entries, returned oldest first. */
export async function readRecentMoodScores(
  userId: string,
  take = 90,
): Promise<RecentMoodScore[]> {
  const rows = await prisma.moodEntry.findMany({
    where: { userId, deletedAt: null },
    orderBy: { moodLoggedAt: "desc" },
    take,
    select: { date: true, score: true, moodLoggedAt: true },
  });
  return rows.reverse();
}
