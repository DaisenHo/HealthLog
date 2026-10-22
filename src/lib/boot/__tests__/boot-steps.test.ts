import { describe, expect, it } from "vitest";

import {
  beginBootStep,
  bootSteps,
  currentBootStep,
  endBootSteps,
} from "../boot-steps";

describe("boot steps", () => {
  it("times each step until the next begins, and names the running one", () => {
    beginBootStep("a", 100);
    expect(currentBootStep()).toBe("a");
    beginBootStep("b", 130);
    expect(currentBootStep()).toBe("b");
    const steps = endBootSteps(200);
    expect(currentBootStep()).toBeNull();
    expect(steps.slice(-2)).toEqual([
      { name: "a", startedAtMs: 100, durationMs: 30 },
      { name: "b", startedAtMs: 130, durationMs: 70 },
    ]);
    expect(bootSteps().slice(-2)).toEqual(steps.slice(-2));
  });
});
