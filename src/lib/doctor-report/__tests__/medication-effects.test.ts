/**
 * The report's medication-effect block reads only what its gate admits: a
 * target whose own measurement leaf is withheld never comes back as an
 * effect, the reads stop at the report's end, and the block is bounded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, resolveTargets, loadEffects } = vi.hoisted(() => ({
  findMany: vi.fn(),
  resolveTargets: vi.fn(),
  loadEffects: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { medication: { findMany } } }));
vi.mock("@/lib/medications/efficacy/build-efficacy", () => ({
  resolveEffectiveTargets: resolveTargets,
}));
vi.mock("@/lib/medications/efficacy/load-segmented-effects", () => ({
  EFFECT_MEDICATION_INCLUDE: {},
  loadSegmentedEffects: loadEffects,
}));

import {
  loadReportMedicationEffects,
  REPORT_EFFECT_MEDICATION_CAP,
} from "../medication-effects";

const END = new Date("2026-05-01T00:00:00.000Z");

function med(id: string) {
  return {
    id,
    name: `Drug ${id}`,
    treatmentClass: "ANTIHYPERTENSIVE",
    atcCode: null,
    startsOn: new Date("2026-02-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  findMany.mockReset();
  resolveTargets.mockReset();
  loadEffects.mockReset();
  resolveTargets.mockResolvedValue({
    tier: "atc",
    cls: "x",
    targets: [
      { kind: "metric", measurementType: "BLOOD_PRESSURE_SYS" },
      { kind: "metric", measurementType: "BLOOD_PRESSURE_DIA" },
      { kind: "lab", analyte: "Potassium", label: "Potassium" },
    ],
  });
  loadEffects.mockImplementation(
    async ({ targets }: { targets: string[] }) =>
      new Map(targets.map((t) => [t, { present: false, reason: "no_start" }])),
  );
});

describe("loadReportMedicationEffects", () => {
  it("keeps only metric targets whose own leaf is admitted, and stops at the report end", async () => {
    findMany.mockResolvedValue([med("a")]);
    const out = await loadReportMedicationEffects({
      userId: "u1",
      medicationIds: ["a"],
      admitsMeasurement: (type) => type === "BLOOD_PRESSURE_SYS",
      timezone: "Europe/Berlin",
      end: END,
    });
    expect(out).toHaveLength(1);
    expect(out![0].targets.map((t) => t.type)).toEqual(["BLOOD_PRESSURE_SYS"]);
    expect(out![0].startsOn).toBe("2026-02-01");
    expect(loadEffects).toHaveBeenCalledWith(
      expect.objectContaining({
        targets: ["BLOOD_PRESSURE_SYS"],
        now: END,
        timezone: "Europe/Berlin",
      }),
    );
    // Owner-scoped, one-shot medications excluded at the query.
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "u1", id: { in: ["a"] }, oneShot: false },
      }),
    );
  });

  it("drops a medication none of whose targets is admitted, and answers null when nothing remains", async () => {
    findMany.mockResolvedValue([med("a")]);
    const out = await loadReportMedicationEffects({
      userId: "u1",
      medicationIds: ["a"],
      admitsMeasurement: () => false,
      timezone: "UTC",
      end: END,
    });
    expect(out).toBeNull();
    expect(loadEffects).not.toHaveBeenCalled();
  });

  it("reads nothing without medications", async () => {
    const out = await loadReportMedicationEffects({
      userId: "u1",
      medicationIds: [],
      admitsMeasurement: () => true,
      timezone: "UTC",
      end: END,
    });
    expect(out).toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("caps the number of medications it computes", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
    findMany.mockResolvedValue(ids.map(med));
    const out = await loadReportMedicationEffects({
      userId: "u1",
      medicationIds: ids,
      admitsMeasurement: () => true,
      timezone: "UTC",
      end: END,
    });
    expect(out).toHaveLength(REPORT_EFFECT_MEDICATION_CAP);
    expect(loadEffects).toHaveBeenCalledTimes(REPORT_EFFECT_MEDICATION_CAP);
    // In the report's own list order.
    expect(out![0].medicationName).toBe("Drug m0");
  });
});
