/**
 * A chronic condition does not zero-fill the symptom-severity series, but its
 * logged days stay in it.
 *
 * The series fills healthy days with 0 across an episode's span. A chronic
 * condition has no end, so its span covered the whole window and the engine
 * correlated a near-constant run of zeros. Only episodes that can put the
 * account into Rest Mode carry a span. The first cut of that fix dropped the
 * chronic episode from the read altogether, which also dropped every day the
 * person had logged for it: a chronic-only account had no channel at all.
 * The fake store honours the episode filter the way Postgres would.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Episode = {
  id: string;
  lifecycle: string;
  onsetAt: Date;
  resolvedAt: Date | null;
};
type DayLog = { episodeId: string; date: string; functionalImpact: number };
const store: { episodes: Episode[]; dayLogs: DayLog[] } = {
  episodes: [],
  dayLogs: [],
};

vi.mock("@/lib/db", () => ({
  prisma: {
    illnessEpisode: {
      findMany: vi.fn(
        async (args: { where: { lifecycle?: { not: string } } }) =>
          store.episodes.filter(
            (e) =>
              args.where.lifecycle === undefined ||
              e.lifecycle !== args.where.lifecycle.not,
          ),
      ),
    },
    illnessDayLog: {
      findMany: vi.fn(
        async (args: { where: { episodeId: { in: string[] } } }) =>
          store.dayLogs
            .filter((d) => args.where.episodeId.in.includes(d.episodeId))
            .map((d) => ({
              date: d.date,
              functionalImpact: d.functionalImpact,
              symptomLinks: [],
            })),
      ),
    },
  },
}));

import { fetchSymptomSeries } from "../correlation-channel-series";

const DAY = 24 * 60 * 60 * 1000;
const since = new Date(Date.now() - 60 * DAY);

const dayKeyAgo = (days: number) =>
  new Date(Date.now() - days * DAY).toISOString().slice(0, 10);

beforeEach(() => {
  store.episodes = [];
  store.dayLogs = [];
});

describe("fetchSymptomSeries", () => {
  it("has no zero-filled series for a chronic condition without logs", async () => {
    store.episodes = [
      {
        id: "chronic",
        lifecycle: "CHRONIC_ONGOING",
        onsetAt: new Date(Date.now() - 900 * DAY),
        resolvedAt: null,
      },
    ];
    const series = await fetchSymptomSeries("user-1", "UTC", since);
    expect(series.points).toEqual([]);
  });

  it("fills only the acute episode's span beside a chronic one", async () => {
    store.episodes = [
      {
        id: "chronic",
        lifecycle: "CHRONIC_ONGOING",
        onsetAt: new Date(Date.now() - 900 * DAY),
        resolvedAt: null,
      },
      {
        id: "cold",
        lifecycle: "ACUTE",
        onsetAt: new Date(Date.now() - 20 * DAY),
        resolvedAt: new Date(Date.now() - 14 * DAY),
      },
    ];
    const series = await fetchSymptomSeries("user-1", "UTC", since);
    expect(series.points.length).toBeGreaterThanOrEqual(6);
    expect(series.points.length).toBeLessThanOrEqual(8);
  });

  it("keeps the logged days of a chronic condition, without zero-fill", async () => {
    store.episodes = [
      {
        id: "chronic",
        lifecycle: "CHRONIC_ONGOING",
        onsetAt: new Date(Date.now() - 900 * DAY),
        resolvedAt: null,
      },
    ];
    store.dayLogs = [
      { episodeId: "chronic", date: dayKeyAgo(10), functionalImpact: 3 },
      { episodeId: "chronic", date: dayKeyAgo(5), functionalImpact: 1 },
    ];
    const series = await fetchSymptomSeries("user-1", "UTC", since);
    expect(series.points).toEqual([
      { day: dayKeyAgo(10), value: 3 },
      { day: dayKeyAgo(5), value: 1 },
    ]);
  });
});
