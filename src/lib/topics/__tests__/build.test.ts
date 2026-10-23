import { describe, expect, it } from "vitest";

import { shiftDateKey } from "@/lib/tz/format";

import { buildDetail, buildOverview, summarise } from "../build";
import type { TopicInputs } from "../read";
import { TOPICS, type TopicSignalKey } from "../registry";
import type { TopicVisibility } from "../visibility";

const TODAY = "2026-10-23";

function series(n: number, f: (i: number) => number) {
  const out = new Map<string, number>();
  for (let i = 0; i < n; i++) out.set(shiftDateKey(TODAY, -(n - 1 - i)), f(i));
  return out;
}

function inputs(
  entries: Array<[TopicSignalKey, Map<string, number>]>,
  extra: Partial<TopicInputs> = {},
): TopicInputs {
  return {
    series: new Map(entries),
    labs: null,
    training: null,
    screeners: null,
    cycle: null,
    ...extra,
  };
}

const everything: TopicVisibility = { modules: {}, sees: () => true };

describe("summarise", () => {
  it("names the first signal outside its usual range", () => {
    const data = inputs([
      ["RESTING_HEART_RATE", series(30, (i) => (i === 29 ? 75 : 58 + (i % 2)))],
    ]);
    const detail = buildDetail(TOPICS.heart, "30d", data, everything, TODAY);
    expect(detail.summary).toMatchObject({
      code: "outside",
      signal: "RESTING_HEART_RATE",
      direction: "above",
    });
  });

  it("is still learning below a week, and empty without anything", () => {
    expect(
      summarise(
        [
          {
            key: "WEIGHT",
            latest: { day: TODAY, value: 80 },
            usual: null,
            state: "learning",
            href: null,
          },
        ],
        inputs([]),
      ).code,
    ).toBe("learning");
    expect(summarise([], inputs([])).code).toBe("empty");
  });
});

describe("buildOverview", () => {
  it("gives a tile to a topic with data and names the empty and the hidden ones", () => {
    const data = inputs([["WEIGHT", series(20, () => 80)]]);
    const overview = buildOverview(
      ["heart", "body"],
      ["cycle"],
      data,
      everything,
      TODAY,
    );
    expect(overview.topics.map((t) => t.key)).toEqual(["body"]);
    expect(overview.empty).toEqual(["heart"]);
    expect(overview.hiddenByModule).toEqual(["cycle"]);
    const body = overview.topics[0];
    expect(body.headline).toMatchObject({ kind: "signal", key: "WEIGHT" });
    expect(body.sparkline).toHaveLength(20);
    expect(body.recorded).toBe(1);
    expect(body.total).toBe(TOPICS.body.signals.length);
    expect(body.tone).toBe("steady");
  });
});

describe("buildDetail", () => {
  it("lists what it could show but holds nothing for, and says it is partial", () => {
    const data = inputs([["RESTING_HEART_RATE", series(20, () => 58)]]);
    const detail = buildDetail(TOPICS.heart, "30d", data, everything, TODAY);
    expect(detail.status).toBe("partial");
    expect(detail.missing).toContain("HEART_RATE_VARIABILITY");
    expect(detail.series.map((s) => s.key)).toEqual(["RESTING_HEART_RATE"]);
    expect(detail.from).toBe(shiftDateKey(TODAY, -29));
    expect(detail.series[0].points).toHaveLength(20);
  });

  it("never names a pair or a chart row whose module is off", () => {
    const sleepOff: TopicVisibility = {
      modules: { sleep: false },
      sees: () => true,
    };
    const data = inputs([
      ["RESTING_HEART_RATE", series(30, () => 58)],
      ["SLEEP_DURATION", series(30, () => 420)],
    ]);
    const detail = buildDetail(TOPICS.heart, "30d", data, sleepOff, TODAY);
    expect(detail.series.map((s) => s.key)).not.toContain("SLEEP_DURATION");
    expect(
      detail.relationships.some(
        (r) => r.x === "SLEEP_DURATION" || r.y === "SLEEP_DURATION",
      ),
    ).toBe(false);
  });

  it("states a below-threshold pair with its count instead of a figure", () => {
    const data = inputs([
      ["SLEEP_DURATION", series(10, () => 400)],
      ["RESTING_HEART_RATE", series(10, () => 60)],
    ]);
    const detail = buildDetail(TOPICS.heart, "30d", data, everything, TODAY);
    const pair = detail.relationships.find(
      (r) => r.id === "short-nights-resting-hr",
    );
    expect(pair).toMatchObject({ status: "insufficient", pairedDays: 10 });
  });

  it("does not name a pair one side of which holds nothing", () => {
    const data = inputs([["ACTIVITY_STEPS", series(30, () => 8000)]]);
    const detail = buildDetail(
      TOPICS.metabolism,
      "30d",
      data,
      everything,
      TODAY,
    );
    expect(detail.relationships).toEqual([]);
  });

  it("drops a block the grant does not open", () => {
    const noLabs: TopicVisibility = {
      modules: {},
      sees: (scope) => scope !== "labs",
    };
    const labs = {
      markers: [],
      inRange: 0,
      withRange: 0,
      latestOn: null,
    };
    const detail = buildDetail(
      TOPICS.metabolism,
      "30d",
      inputs([], { labs }),
      noLabs,
      TODAY,
    );
    expect(detail.labs).toBeNull();
  });
});
