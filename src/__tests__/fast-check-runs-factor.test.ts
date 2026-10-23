/**
 * The nightly property runs multiply each property's own case count instead
 * of replacing it. A nightly count of 100 for every property ran the backup
 * round trip, which states twelve cases for its cost, eight times over
 * against a timeout sized for twelve.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

async function loadWith(factor: string | undefined) {
  vi.resetModules();
  if (factor === undefined) vi.stubEnv("FC_RUNS_FACTOR", "");
  else vi.stubEnv("FC_RUNS_FACTOR", factor);
  return import("../../tests/property/fast-check");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("FC_RUNS_FACTOR", () => {
  it("keeps each property's own count on a pull request", async () => {
    const { propertyParameters, propertyTimeout } = await loadWith(undefined);
    expect(propertyParameters(12).numRuns).toBe(12);
    expect(propertyParameters().numRuns).toBe(100);
    expect(propertyTimeout(60_000)).toBe(60_000);
  });

  it("multiplies each property's count and the timeout it was given", async () => {
    const { propertyParameters, propertyTimeout } = await loadWith("4");
    expect(propertyParameters(12).numRuns).toBe(48);
    expect(propertyParameters(300).numRuns).toBe(1200);
    expect(propertyTimeout(60_000)).toBe(240_000);
  });

  it("ignores a value that is not a positive number", async () => {
    const { propertyParameters } = await loadWith("-3");
    expect(propertyParameters(12).numRuns).toBe(12);
  });
});
