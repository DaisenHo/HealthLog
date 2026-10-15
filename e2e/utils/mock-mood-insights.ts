import type { Page } from "@playwright/test";

/**
 * Route mocks for the /insights/mood density guard.
 *
 * The correlation cards and the discovered-relations list only render with
 * data, and the seeded e2e account has none — an unmocked run would pass the
 * tile-escape guard vacuously against empty states. These payloads pin the
 * measured worst case: five populated correlation cards whose header caption
 * ("269 gepaarte Tage · r = 0.37") used to escape the card edge by 14–39 px
 * at 390/360, plus mood-involving discovered pairs whose stat caption wrapped
 * to a 4-line sliver beside the finding sentence.
 */

function correlation(r: number, strength: string, n: number) {
  return {
    result: { r, strength, n },
    n,
    points: Array.from({ length: 24 }, (_, i) => ({
      x: 1 + (i % 5),
      y: 40 + ((i * 7) % 55),
    })),
  };
}

/**
 * A calendar day this many days back, so the heatmap cells stay inside its
 * 90-day window whenever the suite runs.
 */
function dayKeyDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

const MOOD_INSIGHTS_PAYLOAD = {
  summary: { totalEntries: 269, inTargetPct: 62 },
  heatmap: {
    windowDays: 90,
    cells: [
      { date: dayKeyDaysAgo(14), score: 4, samples: 2 },
      { date: dayKeyDaysAgo(13), score: 3, samples: 1 },
    ],
  },
  distribution: [],
  weekday: [],
  timeOfDay: { reliable: false },
  stability: null,
  tags: [],
  structuredTags: [],
  tagInfluence: { flat: [], structured: [] },
  betterDays: [],
  tagMetricCrosstab: [],
  factorCrosstab: [],
  narratives: [],
  correlations: {
    sleep: correlation(0.37, "schwach", 269),
    steps: correlation(0.52, "moderat", 231),
    pulse: correlation(-0.44, "moderat", 258),
    weight: correlation(0.21, "schwach", 244),
    bloodPressureSystolic: correlation(-0.73, "stark", 212),
  },
};

const CORRELATION_DISCOVERY_PAYLOAD = {
  discovered: [
    {
      behaviour: "SLEEP_DURATION",
      outcome: "MOOD",
      n: 269,
      r: 0.37,
      pValue: 0.001,
      qValue: 0.012,
      interpretation: "",
      lagDays: 1,
    },
    {
      behaviour: "MOOD",
      outcome: "RESTING_HEART_RATE",
      n: 231,
      r: -0.41,
      pValue: 0.002,
      qValue: 0.031,
      interpretation: "",
      lagDays: 1,
    },
    {
      behaviour: "TIME_IN_DAYLIGHT",
      outcome: "MOOD",
      n: 187,
      r: 0.29,
      pValue: 0.004,
      qValue: 0.048,
      interpretation: "",
      lagDays: 0,
    },
  ],
  pairsTested: 42,
  fdrQ: 0.1,
  minPairs: 20,
};

/** Serve populated mood-insights + discovery payloads for the density guard. */
export async function mockMoodInsights(page: Page): Promise<void> {
  await page.route(/\/api\/insights\/comprehensive(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: { moodSummary: { count: 269 } },
        error: null,
      }),
    });
  });
  await page.route(/\/api\/mood\/insights(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: MOOD_INSIGHTS_PAYLOAD, error: null }),
    });
  });
  await page.route(/\/api\/insights\/correlations(\?|$)/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: CORRELATION_DISCOVERY_PAYLOAD,
        error: null,
      }),
    });
  });
}
