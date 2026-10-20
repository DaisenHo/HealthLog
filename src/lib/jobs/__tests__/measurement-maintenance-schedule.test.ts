/**
 * The nightly measurements check: what it decides from the table's
 * statistics. It never vacuums and never rebuilds, since autovacuum owns the
 * vacuuming (migration 0412); it warns when autovacuum falls behind. The
 * operator's run keeps the steps it names.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {},
  sessionOptionsDisabled: () => false,
}));

import {
  AUTOVACUUM_SCALE_FACTOR,
  DEAD_ROW_WARN_FLOOR,
  autovacuumBehind,
  resolveSteps,
  tableHealth,
  type TableHealth,
} from "@/lib/jobs/measurement-maintenance";

const health = (over: Partial<TableHealth> = {}): TableHealth => ({
  liveRows: 1_000_000,
  deadRows: 0,
  heapBytes: 0,
  bloatFactor: null,
  ...over,
});

describe("autovacuumBehind", () => {
  it("matches the threshold migration 0412 sets on the table", () => {
    const migration = readFileSync(
      join(
        process.cwd(),
        "prisma/migrations/0412_measurement_hot_updates/migration.sql",
      ),
      "utf8",
    );
    expect(migration).toContain(
      `autovacuum_vacuum_scale_factor = ${AUTOVACUUM_SCALE_FACTOR}`,
    );
  });

  it("warns once dead rows pass four times autovacuum's threshold", () => {
    expect(autovacuumBehind(health({ deadRows: 200_001 }))).toBe(true);
    expect(autovacuumBehind(health({ deadRows: 199_999 }))).toBe(false);
  });

  it("leaves a small table alone below the floor", () => {
    expect(
      autovacuumBehind(
        health({ liveRows: 100, deadRows: DEAD_ROW_WARN_FLOOR - 1 }),
      ),
    ).toBe(false);
  });
});

describe("resolveSteps", () => {
  it("gives the nightly tick no step at all, whatever the dead rows", () => {
    expect(resolveSteps({})).toEqual({ vacuum: false, reindex: false });
    expect(resolveSteps(undefined)).toEqual({ vacuum: false, reindex: false });
  });

  it("keeps the operator's steps", () => {
    expect(resolveSteps({ vacuum: false, reindex: true })).toEqual({
      vacuum: false,
      reindex: true,
    });
    expect(resolveSteps({ vacuum: true, reindex: false })).toEqual({
      vacuum: true,
      reindex: false,
    });
    expect(resolveSteps({ vacuum: true })).toEqual({
      vacuum: true,
      reindex: true,
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
