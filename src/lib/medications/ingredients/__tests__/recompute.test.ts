/**
 * v1.43 — the pure half of the supplement recompute: taken dose slots summed
 * into one row per local day and nutrient.
 */
import { Prisma } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";

import {
  supplementNutrientRows,
  type SupplementMedication,
} from "../recompute";

const TZ = "Europe/Berlin";

function medication(
  over: Partial<SupplementMedication> = {},
): SupplementMedication {
  return {
    id: "med-1",
    unitsPerDose: new Prisma.Decimal(2),
    schedules: [],
    ingredients: [{ nutrient: "vitamin_d", amountPerUnit: 25 }],
    ...over,
  };
}

const at = (iso: string) => new Date(iso);

describe("supplementNutrientRows", () => {
  it("multiplies the amount per unit by the units per dose", () => {
    expect(
      supplementNutrientRows(
        [{ medicationId: "med-1", scheduledFor: at("2026-07-10T06:00:00Z") }],
        [medication()],
        TZ,
      ),
    ).toEqual([
      { day: "2026-07-10", nutrient: "vitamin_d", amount: 50, unit: "ug" },
    ]);
  });

  it("counts two rows of one slot once", () => {
    const slot = at("2026-07-10T06:00:00Z");
    const rows = supplementNutrientRows(
      [
        { medicationId: "med-1", scheduledFor: slot },
        { medicationId: "med-1", scheduledFor: new Date(slot.getTime()) },
      ],
      [medication()],
      TZ,
    );
    expect(rows.map((r) => r.amount)).toEqual([50]);
  });

  it("puts a dose on the local day of its slot, not the UTC day", () => {
    // 23:30 UTC on the 9th is 01:30 on the 10th in Berlin.
    const rows = supplementNutrientRows(
      [{ medicationId: "med-1", scheduledFor: at("2026-07-09T23:30:00Z") }],
      [medication()],
      TZ,
    );
    expect(rows[0].day).toBe("2026-07-10");
  });

  it("sums several medications and doses into one row per day and nutrient", () => {
    const rows = supplementNutrientRows(
      [
        { medicationId: "med-1", scheduledFor: at("2026-07-10T06:00:00Z") },
        { medicationId: "med-1", scheduledFor: at("2026-07-10T18:00:00Z") },
        { medicationId: "med-2", scheduledFor: at("2026-07-10T12:00:00Z") },
        { medicationId: "med-2", scheduledFor: at("2026-07-11T12:00:00Z") },
      ],
      [
        medication(),
        medication({
          id: "med-2",
          unitsPerDose: new Prisma.Decimal(1),
          ingredients: [
            { nutrient: "vitamin_d", amountPerUnit: 20 },
            { nutrient: "dha", amountPerUnit: 250 },
          ],
        }),
      ],
      TZ,
    );
    expect(rows).toEqual([
      { day: "2026-07-10", nutrient: "dha", amount: 250, unit: "mg" },
      { day: "2026-07-10", nutrient: "vitamin_d", amount: 120, unit: "ug" },
      { day: "2026-07-11", nutrient: "dha", amount: 250, unit: "mg" },
      { day: "2026-07-11", nutrient: "vitamin_d", amount: 20, unit: "ug" },
    ]);
  });

  it("resolves a per-slot units-per-dose the way the inventory does", () => {
    // Half a tablet at noon, the medication default (2) otherwise.
    const rows = supplementNutrientRows(
      [{ medicationId: "med-1", scheduledFor: at("2026-07-10T10:00:00Z") }],
      [
        medication({
          schedules: [
            {
              timesOfDay: ["12:00"],
              windowStart: "12:00",
              unitsPerDose: new Prisma.Decimal(0.5),
            },
          ],
        }),
      ],
      TZ,
    );
    expect(rows[0].amount).toBe(12.5);
  });

  it("skips a code the catalogue does not know and a medication without a composition", () => {
    const rows = supplementNutrientRows(
      [
        { medicationId: "med-1", scheduledFor: at("2026-07-10T06:00:00Z") },
        { medicationId: "med-x", scheduledFor: at("2026-07-10T06:00:00Z") },
      ],
      [
        medication({
          ingredients: [{ nutrient: "retired", amountPerUnit: 5 }],
        }),
      ],
      TZ,
    );
    expect(rows).toEqual([]);
  });

  it("rounds away binary noise", () => {
    const rows = supplementNutrientRows(
      [{ medicationId: "med-1", scheduledFor: at("2026-07-10T06:00:00Z") }],
      [
        medication({
          unitsPerDose: new Prisma.Decimal(3),
          ingredients: [{ nutrient: "copper", amountPerUnit: 0.1 }],
        }),
      ],
      TZ,
    );
    expect(rows[0].amount).toBe(0.3);
  });
});
