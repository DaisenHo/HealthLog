import { describe, it, expect } from "vitest";
import {
  pickAggregateGrain,
  rangeLengthDays,
  DAILY_AGGREGATE_THRESHOLD_DAYS,
  WEEKLY_AGGREGATE_THRESHOLD_DAYS,
  MONTHLY_AGGREGATE_THRESHOLD_DAYS,
  BUCKET_CAP,
} from "../range-aggregation";

describe("range-aggregation", () => {
  describe("pickAggregateGrain", () => {
    it("returns raw for ranges at or under the daily threshold", () => {
      expect(pickAggregateGrain(7)).toBe("raw");
      expect(pickAggregateGrain(30)).toBe("raw");
      expect(pickAggregateGrain(DAILY_AGGREGATE_THRESHOLD_DAYS)).toBe("raw");
    });

    it("returns daily for ranges between 90 and 365 days", () => {
      expect(pickAggregateGrain(DAILY_AGGREGATE_THRESHOLD_DAYS + 1)).toBe(
        "daily",
      );
      expect(pickAggregateGrain(180)).toBe("daily");
      expect(pickAggregateGrain(WEEKLY_AGGREGATE_THRESHOLD_DAYS)).toBe("daily");
    });

    it("returns weekly for ranges over one year up to two years", () => {
      expect(pickAggregateGrain(WEEKLY_AGGREGATE_THRESHOLD_DAYS + 1)).toBe(
        "weekly",
      );
      expect(pickAggregateGrain(MONTHLY_AGGREGATE_THRESHOLD_DAYS)).toBe(
        "weekly",
      );
    });

    it("returns monthly for ranges over two years", () => {
      expect(pickAggregateGrain(MONTHLY_AGGREGATE_THRESHOLD_DAYS + 1)).toBe(
        "monthly",
      );
      expect(pickAggregateGrain(3650)).toBe("monthly");
    });

    it("honours an explicit grain override", () => {
      expect(pickAggregateGrain(7, "daily")).toBe("daily");
      expect(pickAggregateGrain(7, "weekly")).toBe("weekly");
      expect(pickAggregateGrain(7, "monthly")).toBe("monthly");
      // "raw" override falls through to the threshold ladder.
      expect(pickAggregateGrain(500, "raw")).toBe("weekly");
    });
  });

  describe("BUCKET_CAP", () => {
    it("caps daily at 365 buckets and monthly at 24", () => {
      expect(BUCKET_CAP.daily).toBe(365);
      expect(BUCKET_CAP.monthly).toBe(24);
      expect(BUCKET_CAP.weekly).toBeGreaterThan(BUCKET_CAP.monthly);
    });
  });

  describe("rangeLengthDays", () => {
    it("counts inclusive days for the same calendar window", () => {
      const from = new Date("2026-05-01T00:00:00.000Z");
      const to = new Date("2026-05-08T00:00:00.000Z");
      expect(rangeLengthDays(from, to)).toBe(7);
    });

    it("returns at least 1 for sub-day windows", () => {
      const t = new Date("2026-05-01T00:00:00.000Z");
      expect(rangeLengthDays(t, t)).toBe(1);
    });
  });
});
