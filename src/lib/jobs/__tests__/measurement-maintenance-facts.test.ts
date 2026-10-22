/**
 * #1271: the nightly measurements check failed every run, because it reported
 * its bloat factor (heap size over what the live rows need, a ratio such as
 * 1.3) as a job fact, and a fact is a non-negative whole number. The factor
 * now rides as whole percent.
 *
 * The handler runs for real against a stand-in connection that answers the
 * table-statistics read with a heap 1.3 times what its rows need; its outcome
 * goes through the strict serializer, which refused the old fact.
 */
import { describe, expect, it, vi } from "vitest";
import type { Job } from "pg-boss";

vi.mock("pg", () => ({
  Client: class {
    on() {}
    async connect() {}
    async end() {}
    async query(sql: string) {
      if (sql.includes("pg_stat_user_tables")) {
        // 1,000 rows of 72 bytes plus 28 of overhead at fill factor 0.85
        // need about 117,647 bytes; the heap holds 1.3 times that.
        return {
          rows: [{ live: "1000", dead: "40", heap: "152941", width: "72" }],
        };
      }
      if (sql.includes("pg_total_relation_size")) {
        return { rows: [{ table: "300000", indexes: "100000" }] };
      }
      return { rows: [] };
    }
  },
}));
vi.mock("@/lib/db", () => ({ sessionOptionsDisabled: () => true }));
vi.mock("@/lib/jobs/job-lock", () => ({
  withJobLock: async (_queue: string, run: () => Promise<unknown>) => ({
    ran: true,
    result: await run(),
  }),
}));
vi.mock("@/lib/jobs/job-run-report", () => ({ reportJobRun: () => {} }));

import {
  jobDone,
  percentFact,
  serializeJobOutcome,
  wholeFact,
} from "../job-outcome";
import {
  handleMeasurementMaintenance,
  type MeasurementMaintenancePayload,
} from "../measurement-maintenance";

describe("the measurement maintenance outcome", () => {
  it("serialises with a realistic, fractional bloat factor", async () => {
    const outcome = await handleMeasurementMaintenance([
      { id: "run-1", data: {} } as Job<MeasurementMaintenancePayload>,
    ]);
    expect(outcome.ok).toBe(true);
    const serialized = serializeJobOutcome(outcome);
    expect(serialized.ok).toBe(true);
    expect(serialized.did).toMatchObject({
      dead_rows: 40,
      bloat_percent: 130,
    });
    expect(serialized.did).not.toHaveProperty("bloat_factor");
  });
});

describe("the fact helpers", () => {
  it("round a measured value to a whole, non-negative fact", () => {
    expect(wholeFact(12.5)).toBe(13);
    expect(wholeFact(-4)).toBe(0);
    expect(wholeFact(Number.NaN)).toBe(0);
    expect(wholeFact(null)).toBe(0);
  });

  it("turn a ratio into whole percent", () => {
    expect(percentFact(1.3)).toBe(130);
    expect(percentFact(0.004)).toBe(0);
    expect(percentFact(undefined)).toBe(0);
  });

  it("leave the strict serializer refusing what the helpers exist to prevent", () => {
    expect(() => serializeJobOutcome(jobDone({ dead_rows: 1.3 }))).toThrow(
      /non-negative safe integer/,
    );
  });
});
