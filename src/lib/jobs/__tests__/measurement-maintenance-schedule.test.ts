/**
 * The nightly measurements check: what it decides from the table's
 * statistics. It vacuums only when dead rows pile up and never rebuilds; the
 * operator's run keeps the steps it names.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  sessionOptionsDisabled: () => false,
}));

import {
  DEAD_ROW_VACUUM_FLOOR,
  resolveSteps,
  tableHealth,
  vacuumDue,
  type TableHealth,
} from "@/lib/jobs/measurement-maintenance";

const health = (over: Partial<TableHealth> = {}): TableHealth => ({
  liveRows: 1_000_000,
  deadRows: 0,
  heapBytes: 0,
  bloatFactor: null,
  ...over,
});

describe("vacuumDue", () => {
  it("vacuums once dead rows pass a tenth of the live ones", () => {
    expect(vacuumDue(health({ deadRows: 100_001 }))).toBe(true);
    expect(vacuumDue(health({ deadRows: 99_999 }))).toBe(false);
  });

  it("leaves a small table alone below the floor", () => {
    expect(
      vacuumDue(health({ liveRows: 100, deadRows: DEAD_ROW_VACUUM_FLOOR - 1 })),
    ).toBe(false);
  });
});

describe("resolveSteps", () => {
  it("gives the nightly tick a vacuum when one is due and never a rebuild", () => {
    expect(resolveSteps({}, health({ deadRows: 500_000 }))).toEqual({
      vacuum: true,
      reindex: false,
    });
    expect(resolveSteps(undefined, health())).toEqual({
      vacuum: false,
      reindex: false,
    });
  });

  it("keeps the operator's steps whatever the statistics say", () => {
    expect(resolveSteps({ vacuum: false, reindex: true }, health())).toEqual({
      vacuum: false,
      reindex: true,
    });
    expect(resolveSteps({ vacuum: true, reindex: false }, health())).toEqual({
      vacuum: true,
      reindex: false,
    });
  });
});

describe("tableHealth", () => {
  it("measures the heap against what the live rows need", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        // 1,000 rows of 72 bytes plus 28 of overhead at fill factor 0.85
        // need about 117,647 bytes; the heap holds 1,176,470.
        rows: [{ live: "1000", dead: "50", heap: "1176470", width: "72" }],
      }),
    };
    expect(await tableHealth(db as never)).toEqual({
      liveRows: 1000,
      deadRows: 50,
      heapBytes: 1176470,
      bloatFactor: 10,
    });
  });

  it("has no factor before the table has statistics", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({
        rows: [{ live: "0", dead: "0", heap: "8192", width: null }],
      }),
    };
    expect((await tableHealth(db as never)).bloatFactor).toBeNull();
  });
});
