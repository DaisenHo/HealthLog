import { describe, expect, it } from "vitest";

import {
  MEDICATION_IMPORT_SKIP_DETAIL_LIMIT,
  MEDICATION_INTAKE_IMPORT_CHUNK_SIZE,
  _setMedicationIntakeImportPrismaForTests,
  advanceMedicationImportProgress,
  appendMedicationImportSkipDetails,
  groupMedicationImportSkips,
  medicationImportChunk,
  processMedicationIntakeImportJob,
  sanitiseMedicationImportFailure,
  totalMedicationImportSkips,
  type MedicationImportProgress,
} from "@/lib/jobs/medication-intake-import";

const INITIAL: MedicationImportProgress = {
  processed: 0,
  total: 1_000,
  imported: 0,
  skippedByReason: {},
  touchedDays: [],
  rollupProcessed: 0,
};

describe("medication intake import worker bounds", () => {
  it("never exposes more than the configured chunk-size to one transaction", () => {
    const entries = Array.from({ length: 1_000 }, (_, index) => ({ index }));
    let cursor = 0;
    const observed: number[] = [];

    while (cursor < entries.length) {
      const chunk = medicationImportChunk(entries, cursor);
      observed.push(chunk.length);
      cursor += chunk.length;
    }

    expect(MEDICATION_INTAKE_IMPORT_CHUNK_SIZE).toBeGreaterThan(0);
    expect(MEDICATION_INTAKE_IMPORT_CHUNK_SIZE).toBeLessThanOrEqual(100);
    expect(Math.max(...observed)).toBe(MEDICATION_INTAKE_IMPORT_CHUNK_SIZE);
    expect(observed.reduce((sum, size) => sum + size, 0)).toBe(1_000);
  });

  it("advances progress monotonically and ignores a stale replay", () => {
    const first = advanceMedicationImportProgress(INITIAL, {
      from: 0,
      processed: 100,
      imported: 98,
      skippedByReason: { duplicate_in_file: 2 },
    });
    const second = advanceMedicationImportProgress(first, {
      from: 100,
      processed: 100,
      imported: 97,
      skippedByReason: { duplicate_in_file: 1, already_recorded: 2 },
    });
    const replay = advanceMedicationImportProgress(second, {
      from: 0,
      processed: 100,
      imported: 98,
      skippedByReason: { duplicate_in_file: 2 },
    });

    expect(first.processed).toBe(100);
    expect(second).toEqual({
      processed: 200,
      total: 1_000,
      imported: 195,
      skippedByReason: { duplicate_in_file: 3, already_recorded: 2 },
      touchedDays: [],
      rollupProcessed: 0,
    });
    expect(replay).toBe(second);
  });

  it("stores a bounded generic failure instead of an internal error", () => {
    const internal = new Error(
      "postgres://queue-user:secret@example.test medication payload leaked",
    );

    const failure = sanitiseMedicationImportFailure(internal);

    expect(failure).toBe("Medication intake import failed");
    expect(failure).not.toContain("secret");
    expect(failure.length).toBeLessThanOrEqual(1_000);
  });

  it("finishes a job admitted with pending rollup days without recomputing them", async () => {
    // A job admitted before the compliance rollup was dropped carries the
    // days it touched and how many of them were recomputed. It now finishes
    // on its next pass, writes nothing per day, and keeps its stored
    // progress shape.
    const touchedDays = Array.from({ length: 1_000 }, (_, index) =>
      new Date(Date.UTC(2020, 0, index + 1)).toISOString().slice(0, 10),
    );
    let persistedProgress: unknown = {
      processed: 0,
      total: 0,
      imported: 0,
      skippedByReason: {},
      touchedDays,
      rollupProcessed: 40,
    };
    let status = "running";
    let executeRawCount = 0;
    let transactions = 0;
    let auditCount = 0;

    const client = {
      $transaction: async (
        operation: (tx: Record<string, unknown>) => Promise<unknown>,
      ) => {
        transactions += 1;
        const tx = {
          $queryRaw: async () => [{ id: "job-legacy-days" }],
          $executeRaw: async () => {
            executeRawCount += 1;
            return 1;
          },
          medicationIntakeImportJob: {
            findUnique: async () => ({
              id: "job-legacy-days",
              recordUserId: "user-1",
              actorUserId: "user-1",
              medicationId: "medication-1",
              status,
              payload: { entries: [] },
              progress: persistedProgress,
              startedAt: new Date(),
            }),
            update: async (args: {
              data: { progress?: unknown; status?: string };
            }) => {
              if (args.data.progress !== undefined) {
                persistedProgress = args.data.progress;
              }
              if (args.data.status !== undefined) status = args.data.status;
              return {};
            },
          },
          auditLog: {
            create: async () => {
              auditCount += 1;
              return {};
            },
          },
        };
        return operation(tx);
      },
    };

    _setMedicationIntakeImportPrismaForTests(client as never);
    try {
      await processMedicationIntakeImportJob("job-legacy-days");
    } finally {
      _setMedicationIntakeImportPrismaForTests(null);
    }

    expect(status).toBe("done");
    expect(transactions).toBe(1);
    expect(executeRawCount).toBe(0);
    expect(auditCount).toBe(1);
    expect(persistedProgress).toMatchObject({
      touchedDays,
      rollupProcessed: 40,
    });
  });
});

describe("medication import skip reporting (#650)", () => {
  it("reports one entry per reason, count descending, and omits zero", () => {
    expect(
      groupMedicationImportSkips({
        duplicate_in_file: 2,
        already_recorded: 9,
      }),
    ).toEqual([
      { reason: "already_recorded", count: 9 },
      { reason: "duplicate_in_file", count: 2 },
    ]);
    expect(
      groupMedicationImportSkips({
        duplicate_in_file: 0,
        already_recorded: 4,
      }),
    ).toEqual([{ reason: "already_recorded", count: 4 }]);
    expect(groupMedicationImportSkips({})).toEqual([]);
  });

  it("totals every reason so the headline count matches the groups", () => {
    const counts = { duplicate_in_file: 2, already_recorded: 9 };
    expect(totalMedicationImportSkips(counts)).toBe(11);
    expect(
      groupMedicationImportSkips(counts).reduce(
        (sum, group) => sum + group.count,
        0,
      ),
    ).toBe(totalMedicationImportSkips(counts));
    expect(totalMedicationImportSkips({})).toBe(0);
  });

  it("keeps the two reasons apart while accumulating across chunks", () => {
    const first = advanceMedicationImportProgress(INITIAL, {
      from: 0,
      processed: 100,
      imported: 90,
      skippedByReason: { duplicate_in_file: 10 },
    });
    const second = advanceMedicationImportProgress(first, {
      from: 100,
      processed: 100,
      imported: 95,
      skippedByReason: { already_recorded: 5 },
    });

    expect(second.skippedByReason).toEqual({
      duplicate_in_file: 10,
      already_recorded: 5,
    });
    expect(groupMedicationImportSkips(second.skippedByReason)).toEqual([
      { reason: "duplicate_in_file", count: 10 },
      { reason: "already_recorded", count: 5 },
    ]);
  });

  it("bounds retained row detail and counts the remainder", () => {
    const details = Array.from(
      { length: MEDICATION_IMPORT_SKIP_DETAIL_LIMIT + 37 },
      (_, index) => ({
        line: index + 1,
        reason: "already_recorded" as const,
      }),
    );
    const accumulated = appendMedicationImportSkipDetails(
      { skipDetails: [], skippedDetailsOmitted: 0 },
      details,
    );

    expect(accumulated.skipDetails).toHaveLength(
      MEDICATION_IMPORT_SKIP_DETAIL_LIMIT,
    );
    expect(accumulated.skippedDetailsOmitted).toBe(37);
    expect(Buffer.byteLength(JSON.stringify(accumulated), "utf8")).toBeLessThan(
      16 * 1024,
    );
  });
});
