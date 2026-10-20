/**
 * A chronic condition does not zero-fill the symptom-severity series.
 *
 * The series fills healthy days with 0 across an episode's span. A chronic
 * condition has no end, so its span covered the whole window and the engine
 * correlated a near-constant run of zeros. Only episodes that can put the
 * account into Rest Mode carry a span; the fake store below honours the
 * lifecycle filter the way Postgres would.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Episode = {
  id: string;
  lifecycle: string;
  onsetAt: Date;
  resolvedAt: Date | null;
};
const store: { episodes: Episode[] } = { episodes: [] };

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
    illnessDayLog: { findMany: vi.fn(async () => []) },
  },
}));

import { fetchSymptomSeries } from "../correlation-channel-series";

const DAY = 24 * 60 * 60 * 1000;
const since = new Date(Date.now() - 60 * DAY);

beforeEach(() => {
  store.episodes = [];
});

describe("fetchSymptomSeries", () => {
  it("has no series for a chronic condition alone", async () => {
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
});
