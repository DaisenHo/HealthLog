/**
 * The integration suite wipes the database between files with one
 * `TRUNCATE`, which needs the strictest lock on every table at once. The
 * server writes in thirty-nine places without awaiting the result, so one of
 * those can land after the test that caused it has returned and take the
 * truncate down with a deadlock. Postgres picks a victim; ours was an
 * unrelated file, twice in two days, green on the rerun both times.
 *
 * The helper retries that one error now. These cases hold it to exactly that:
 * it gives up on anything else immediately, and it does not retry forever.
 */
import { describe, expect, it, vi } from "vitest";

import { truncateAllTables } from "../../tests/integration/setup";
import type { IntegrationDatabasePlan } from "../../tests/integration/worker-database";

/** What global setup reads off the migrated template, cut down to the shape. */
const PLAN: IntegrationDatabasePlan = {
  templateSchemas: ["public"],
  tables: ["app_settings", "mood_tag_categories", "mood_tags", "users"],
  reference: [
    { table: "app_settings", rowsJson: '[{"id":"singleton"}]' },
    { table: "mood_tag_categories", rowsJson: '[{"id":"c1"}]' },
    { table: "mood_tags", rowsJson: '[{"id":"t1","category_id":"c1"}]' },
  ],
};

function deadlock(): Error & { code: string } {
  const error = new Error("deadlock detected") as Error & { code: string };
  error.code = "40P01";
  return error;
}

type Execute = (query: string, ...values: unknown[]) => Promise<number>;

function fakeClient(executeRaw: Execute) {
  return { $executeRawUnsafe: executeRaw };
}

describe("truncateAllTables", () => {
  it("retries a deadlocked truncate and succeeds once the lock clears", async () => {
    const executeRaw = vi
      .fn<Execute>()
      .mockRejectedValueOnce(deadlock())
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValue(0);

    await truncateAllTables(fakeClient(executeRaw), PLAN);

    // Three truncate attempts, then the two seeded tables put back.
    expect(executeRaw).toHaveBeenCalledTimes(5);
  });

  it("empties every catalogued table and puts the seeded rows back in key order", async () => {
    const executeRaw = vi.fn<Execute>().mockResolvedValue(0);

    await truncateAllTables(fakeClient(executeRaw), PLAN);

    const statements = executeRaw.mock.calls.map((call) => String(call[0]));
    expect(statements[0]).toBe(
      'TRUNCATE TABLE "app_settings", "mood_tag_categories", "mood_tags", "users" RESTART IDENTITY CASCADE;',
    );
    // The settings singleton starts empty; the catalogues come back, the
    // category before the tag that references it.
    expect(statements.slice(1)).toEqual([
      expect.stringContaining('INSERT INTO "mood_tag_categories"'),
      expect.stringContaining('INSERT INTO "mood_tags"'),
    ]);
    expect(executeRaw.mock.calls[2][1]).toBe(PLAN.reference[2].rowsJson);
  });

  it("gives up on an error that is not a deadlock, on the first attempt", async () => {
    const other = new Error("permission denied") as Error & { code: string };
    other.code = "42501";
    const executeRaw = vi.fn<Execute>().mockRejectedValue(other);

    await expect(
      truncateAllTables(fakeClient(executeRaw), PLAN),
    ).rejects.toThrow("permission denied");
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });

  it("stops retrying a deadlock that never clears", async () => {
    const executeRaw = vi.fn<Execute>().mockRejectedValue(deadlock());

    await expect(
      truncateAllTables(fakeClient(executeRaw), PLAN),
    ).rejects.toThrow("deadlock detected");
    expect(executeRaw).toHaveBeenCalledTimes(5);
  });
});
