import { describe, expect, it } from "vitest";

import { TOPICS } from "../registry";
import {
  isSignalVisible,
  offeredTopics,
  signalsToRead,
  visibleExtras,
} from "../visibility";

const sees = () => true;

describe("topic visibility", () => {
  it("offers every topic when nothing is switched off", () => {
    expect(offeredTopics({ modules: {}, sees })).toEqual([
      "heart",
      "body",
      "blood-pressure",
      "sleep",
      "activity",
      "metabolism",
      "mind",
      "cycle",
    ]);
  });

  it("follows the modules: cycle only with the cycle module, mind with either of its two", () => {
    const off = offeredTopics({
      modules: { cycle: false, mood: false, mentalHealth: false, sleep: false },
      sees,
    });
    expect(off).not.toContain("cycle");
    expect(off).not.toContain("mind");
    expect(off).not.toContain("sleep");
    expect(off).toContain("heart");
    expect(offeredTopics({ modules: { mood: false }, sees })).toContain("mind");
  });

  it("never reads a signal or a block whose module is off or whose section is closed", () => {
    const ctx = {
      modules: { sleep: false, workouts: false },
      sees: (scope: string) => scope !== "mind",
    };
    expect(isSignalVisible("SLEEP_DURATION", ctx)).toBe(false);
    expect(isSignalVisible("MOOD", ctx)).toBe(false);
    expect(isSignalVisible("PULSE", ctx)).toBe(true);
    expect([...signalsToRead(TOPICS.heart, ctx)]).not.toContain(
      "SLEEP_DURATION",
    );
    expect([...visibleExtras(TOPICS.heart, ctx)]).toEqual([]);
  });
});
