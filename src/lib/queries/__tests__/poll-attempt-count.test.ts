/**
 * A bounded poll counts failed fetches as attempts. On `dataUpdateCount`
 * alone a request that kept failing left the last `preparing` payload in
 * place and polled an open page for as long as it stayed open.
 */
import { describe, expect, it } from "vitest";

import {
  STATUS_POLL_MAX_ATTEMPTS,
  nextStatusPollInterval,
} from "@/hooks/use-insight-status";
import { nextAdvisorPollInterval } from "@/components/insights/use-insights-advisor";
import { pollAttemptCount } from "../refetch-interval";

describe("pollAttemptCount", () => {
  it("adds the failed fetches to the settled ones", () => {
    expect(pollAttemptCount({ dataUpdateCount: 2, errorUpdateCount: 3 })).toBe(
      5,
    );
  });

  it("ends a status poll whose fetches keep failing", () => {
    // One good `preparing` answer, then nothing but errors.
    const failing = { dataUpdateCount: 1, errorUpdateCount: 0 };
    let polls = 0;
    while (nextStatusPollInterval(true, pollAttemptCount(failing)) !== false) {
      failing.errorUpdateCount += 1;
      polls += 1;
      expect(polls).toBeLessThanOrEqual(STATUS_POLL_MAX_ATTEMPTS);
    }
    expect(polls).toBe(STATUS_POLL_MAX_ATTEMPTS - 1);
  });

  it("ends an advisor poll whose fetches keep failing", () => {
    const failing = { dataUpdateCount: 1, errorUpdateCount: 0 };
    let polls = 0;
    while (nextAdvisorPollInterval(true, pollAttemptCount(failing)) !== false) {
      failing.errorUpdateCount += 1;
      polls += 1;
      expect(polls).toBeLessThan(50);
    }
    expect(polls).toBeGreaterThan(0);
  });
});
