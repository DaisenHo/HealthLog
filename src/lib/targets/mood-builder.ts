import { makeRangeClassifier, rollupConsistency } from "./consistency";
import type {
  TargetItem,
  TargetMoodEntry,
  TargetMoodRollup,
  TargetTrend,
} from "./types";
import { READING_SPREAD, standardDeviation } from "@/lib/stats/spread";

interface MoodTargetInput {
  moodRollups: TargetMoodRollup[];
  recentRawMood: TargetMoodEntry[] | null;
  latestMoodEntry: TargetMoodEntry | null;
  timezone: string;
  now: Date;
}

export function buildMoodTargets({
  moodRollups,
  recentRawMood,
  latestMoodEntry,
  timezone,
  now,
}: MoodTargetInput): TargetItem[] {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let dailyEvents: Array<{ measuredAt: Date; value: number }>;
  let entryCount: number;

  if (moodRollups.length > 0) {
    entryCount = moodRollups.reduce((sum, rollup) => sum + rollup.count, 0);
    dailyEvents = moodRollups
      .filter((rollup) => rollup.bucketStart >= thirtyDaysAgo)
      .map((rollup) => ({
        measuredAt: rollup.bucketStart,
        value: rollup.mean,
      }));
  } else if (latestMoodEntry !== null) {
    const rawMood = recentRawMood ?? [];
    entryCount = rawMood.length;
    dailyEvents = rawMood.map((entry) => ({
      measuredAt: entry.moodLoggedAt,
      value: entry.score,
    }));
  } else {
    entryCount = 0;
    dailyEvents = [];
  }
  const values = dailyEvents.map((event) => event.value);

  if (entryCount < 3) return [];

  const current = latestMoodEntry?.score ?? null;
  const average30 =
    values.length > 0
      ? Math.round(
          (values.reduce((sum, v) => sum + v, 0) / values.length) * 10,
        ) / 10
      : null;
  let trend: TargetTrend = null;
  if (dailyEvents.length >= 4) {
    const sorted = [...dailyEvents].sort(
      (a, b) => a.measuredAt.getTime() - b.measuredAt.getTime(),
    );
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);
    const averageFirst =
      firstHalf.reduce((sum, event) => sum + event.value, 0) / firstHalf.length;
    const averageSecond =
      secondHalf.reduce((sum, event) => sum + event.value, 0) /
      secondHalf.length;
    const difference = averageSecond - averageFirst;
    if (difference > 0.2) trend = "up";
    else if (difference < -0.2) trend = "down";
    else trend = "stable";
  }

  const range = { min: 3.5, max: 5 };
  const consistency = rollupConsistency({
    events: dailyEvents,
    classify: makeRangeClassifier(range, { orangeMin: 2, orangeMax: 5 }),
    timezone,
    now,
  });
  const targets: TargetItem[] = [
    {
      type: "MOOD_SCORE",
      label: "Mood",
      current,
      average30,
      trend,
      unit: "/ 5",
      range,
      classification:
        current != null
          ? current >= 3.5
            ? { category: "Good", color: "var(--success)" }
            : current >= 2
              ? { category: "Moderate", color: "var(--dracula-yellow)" }
              : { category: "Low", color: "var(--destructive)" }
          : null,
      source: "Mood entries",
      ...consistency,
    },
  ];

  if (values.length >= 5) {
    const spread =
      Math.round((standardDeviation(values, READING_SPREAD) ?? 0) * 100) / 100;
    targets.push({
      type: "MOOD_STABILITY",
      label: "Mood stability",
      current: spread,
      average30: spread,
      trend: null,
      unit: "σ",
      range: { min: 0, max: 0.5 },
      classification:
        spread <= 0.5
          ? { category: "Very stable", color: "var(--success)" }
          : spread <= 1
            ? { category: "Stable", color: "var(--dracula-yellow)" }
            : { category: "Fluctuating", color: "var(--destructive)" },
      source: "Mood entries",
      ...consistency,
    });
  }

  return targets;
}
