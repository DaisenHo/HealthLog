import { describe, expect, it } from "vitest";

import {
  classifyHourBucket,
  combineHourWrites,
  cumulativeFromIncrements,
  HOUR_NOT_POSTED,
  isStartOfLocalHour,
  parseHourBucketId,
  postedHours,
} from "../intraday-hour-buckets";

const BERLIN = "Europe/Berlin";
const NOW = new Date("2026-10-15T12:00:00.000Z");

describe("parseHourBucketId", () => {
  it("reads the hour form", () => {
    expect(
      parseHourBucketId(
        "stats:HKQuantityTypeIdentifierStepCount:2026-10-14T09",
      ),
    ).toEqual({
      hkIdentifier: "HKQuantityTypeIdentifierStepCount",
      dateKey: "2026-10-14",
      hour: 9,
    });
  });

  it.each([
    "stats:HKQuantityTypeIdentifierStepCount:2026-10-14",
    "stats:HKQuantityTypeIdentifierHeartRate:2026-10-14T09",
    "stats:HKQuantityTypeIdentifierHeartRate:2026-10-14T09:10:00.000Z",
    "stats:HKQuantityTypeIdentifierStepCount:2026-10-14T24",
    "stats:HKQuantityTypeIdentifierStepCount:2026-02-30T09",
    "stats:HKQuantityTypeIdentifierStepCount:2026-10-14T9",
    "uuid-1234",
  ])("leaves %s to its own path", (id) => {
    expect(parseHourBucketId(id)).toBeNull();
  });
});

describe("isStartOfLocalHour", () => {
  const id = { hkIdentifier: "x", dateKey: "2026-10-14", hour: 9 };
  it("accepts the first instant of the local hour only", () => {
    // 09:00 in Berlin (CEST, UTC+2) is 07:00Z.
    expect(
      isStartOfLocalHour(new Date("2026-10-14T07:00:00.000Z"), id, BERLIN),
    ).toBe(true);
    expect(
      isStartOfLocalHour(new Date("2026-10-14T09:00:00.000Z"), id, BERLIN),
    ).toBe(false);
    expect(
      isStartOfLocalHour(new Date("2026-10-14T07:00:00.001Z"), id, BERLIN),
    ).toBe(false);
    expect(
      isStartOfLocalHour(new Date("2026-10-14T07:30:00.000Z"), id, BERLIN),
    ).toBe(false);
  });

  it("accepts either start of a repeated autumn hour and no start of a skipped spring hour", () => {
    const repeated = { hkIdentifier: "x", dateKey: "2026-10-25", hour: 2 };
    expect(
      isStartOfLocalHour(
        new Date("2026-10-25T00:00:00.000Z"),
        repeated,
        BERLIN,
      ),
    ).toBe(true);
    expect(
      isStartOfLocalHour(
        new Date("2026-10-25T01:00:00.000Z"),
        repeated,
        BERLIN,
      ),
    ).toBe(true);
    const skipped = { hkIdentifier: "x", dateKey: "2026-03-29", hour: 2 };
    expect(
      isStartOfLocalHour(new Date("2026-03-29T01:00:00.000Z"), skipped, BERLIN),
    ).toBe(false);
  });
});

describe("classifyHourBucket", () => {
  const steps = (dateKey: string, hour: number) => ({
    hkIdentifier: "HKQuantityTypeIdentifierStepCount",
    dateKey,
    hour,
  });

  it("maps the four summed identifiers", () => {
    expect(
      classifyHourBucket(
        steps("2026-10-14", 9),
        new Date("2026-10-14T07:00:00Z"),
        BERLIN,
        NOW,
      ),
    ).toMatchObject({ ok: true, type: "ACTIVITY_STEPS" });
  });

  it("refuses another identifier", () => {
    expect(
      classifyHourBucket(
        {
          hkIdentifier: "HKQuantityTypeIdentifierBodyMass",
          dateKey: "2026-10-14",
          hour: 9,
        },
        new Date("2026-10-14T07:00:00Z"),
        BERLIN,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "hour_bucket_unsupported_type" });
  });

  it("refuses a start that is not the local hour's start", () => {
    // 09:00Z is 11:00 in Berlin, not 09:00.
    expect(
      classifyHourBucket(
        steps("2026-10-14", 9),
        new Date("2026-10-14T09:00:00Z"),
        BERLIN,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "hour_bucket_misaligned" });
  });

  it("refuses a day more than 400 days back", () => {
    expect(
      classifyHourBucket(
        steps("2025-09-01", 9),
        new Date("2025-09-01T07:00:00Z"),
        BERLIN,
        NOW,
      ),
    ).toEqual({ ok: false, reason: "hour_bucket_too_old" });
    expect(
      classifyHourBucket(
        steps("2025-09-11", 9),
        new Date("2025-09-11T07:00:00Z"),
        BERLIN,
        NOW,
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("cumulativeFromIncrements", () => {
  it("adds only posted hours and keeps the running total flat across gaps", () => {
    const increments = new Array<number>(24).fill(HOUR_NOT_POSTED);
    increments[8] = 100;
    increments[9] = 0;
    increments[12] = 50;
    const cumulative = cumulativeFromIncrements(increments);
    expect(cumulative[7]).toBe(0);
    expect(cumulative[8]).toBe(100);
    expect(cumulative[11]).toBe(100);
    expect(cumulative[23]).toBe(150);
    expect(postedHours(increments)).toBe(3);
  });
});

describe("combineHourWrites", () => {
  const entry = (index: number, startIso: string, value: number) => ({
    index,
    type: "ACTIVITY_STEPS" as const,
    hkIdentifier: "HKQuantityTypeIdentifierStepCount",
    dateKey: "2026-10-25",
    hour: 2,
    value,
    startMs: Date.parse(startIso),
  });

  it("sums the two starts of the hour a fall-back day repeats", () => {
    // Berlin, 2026-10-25: 02:00 CEST is 00:00Z, 02:00 CET is 01:00Z.
    const { writes, superseded } = combineHourWrites([
      entry(0, "2026-10-25T00:00:00Z", 300),
      entry(1, "2026-10-25T01:00:00Z", 120),
    ]);
    expect(superseded).toEqual([]);
    expect(writes).toHaveLength(1);
    expect(writes[0].write.value).toBe(420);
    expect(writes[0].contributors.sort()).toEqual([0, 1]);
  });

  it("lets the last entry of one start win, and marks the earlier one", () => {
    const { writes, superseded } = combineHourWrites([
      entry(0, "2026-10-25T00:00:00Z", 300),
      entry(1, "2026-10-25T00:00:00Z", 310),
      entry(2, "2026-10-25T01:00:00Z", 120),
    ]);
    expect(superseded).toEqual([0]);
    expect(writes[0].write.value).toBe(430);
    expect(writes[0].write.index).toBe(2);
  });
});
