/**
 * The turndown date of the legacy Fitbit Web API, read off the real module
 * (the unit setup pins it off for every other suite).
 */
import { describe, expect, it, vi } from "vitest";

const actual = await vi.importActual<typeof import("@/lib/fitbit/retirement")>(
  "@/lib/fitbit/retirement",
);

describe("Fitbit Web API retirement", () => {
  it("names the day Google published", () => {
    // developers.google.com/health/migration: "On October 30, 2026, the
    // Fitbit Web API will be turned off".
    expect(actual.FITBIT_WEB_API_TURNDOWN_DATE).toBe("2026-10-30");
  });

  it("turns at midnight UTC at the start of that day", () => {
    expect(actual.isFitbitRetired(new Date("2026-10-29T23:59:59.999Z"))).toBe(
      false,
    );
    expect(actual.isFitbitRetired(new Date("2026-10-30T00:00:00.000Z"))).toBe(
      true,
    );
  });

  it("publishes the day, whether it has come, and the successor", () => {
    expect(actual.fitbitRetirement(new Date("2026-10-21T12:00:00Z"))).toEqual({
      endsOn: "2026-10-30",
      ended: false,
      successor: "google-health",
    });
    expect(
      actual.fitbitRetirement(new Date("2026-11-02T12:00:00Z")).ended,
    ).toBe(true);
  });
});
