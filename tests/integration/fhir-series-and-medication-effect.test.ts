/**
 * v1.44 against a real Postgres: the FHIR Observation time series (the UNION
 * page query, its count, the BP pairing, the glucose-context filter, owner and
 * soft-delete scoping), the segmented medication effect read end to end, and
 * the doctor report's workout and effect blocks.
 *
 * The effect fixture: an ACE inhibitor started on 2026-03-01 with systolic
 * readings of exactly 140 for 60 days before and 130 − 0.1·t after, so the
 * fit must recover a level change of −10 mmHg and a slope change of
 * −0.7 mmHg/week, and a second medication starting inside the window must be
 * listed as a confounder.
 */
import { beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";
import {
  emitSeriesPage,
  querySeriesPage,
  resolveSeriesScope,
} from "@/lib/fhir/series";
import {
  EFFECT_MEDICATION_INCLUDE,
  loadSegmentedEffects,
} from "@/lib/medications/efficacy/load-segmented-effects";
import { collectDoctorReportData } from "@/lib/doctor-report-data";
import { selectionFromLeaves } from "@/lib/report-selection/selection";
import type { ReportLeafId } from "@/lib/report-selection/catalogue";

import { getPrismaClient, truncateAllTables } from "./setup";

const DAY = 86_400_000;
const PIVOT = Date.parse("2026-03-01T00:00:00.000Z");

let userId = "";
let otherId = "";
let medId = "";

const MODULES = {
  cycle: false,
  mood: false,
  sleep: true,
  glucose: true,
  workouts: true,
  recovery: true,
  labs: true,
  illness: true,
  achievements: true,
  coach: true,
  insights: true,
  medications: true,
  doctorReport: true,
  environment: true,
  mcp: true,
  inboundDocuments: true,
  mentalHealth: true,
  nutrients: true,
  vaccinations: true,
  timeline: true,
} as const;

const gateOf = (leaves: ReportLeafId[]) => ({
  admits: (leaf: ReportLeafId) => leaves.includes(leaf),
});

beforeAll(async () => {
  const prisma = getPrismaClient();
  await truncateAllTables(prisma);
  const user = await prisma.user.create({
    data: {
      username: "fhir-series-effect",
      email: "fhir-series-effect@example.test",
      timezone: "UTC",
    },
  });
  userId = user.id;
  const other = await prisma.user.create({
    data: {
      username: "fhir-series-other",
      email: "fhir-series-other@example.test",
      timezone: "UTC",
    },
  });
  otherId = other.id;

  const rows: Prisma.MeasurementCreateManyInput[] = [];
  // Systolic: 140 before, 130 − 0.1·t after (one reading a day at 08:00).
  for (let t = -60; t < 60; t++) {
    rows.push({
      userId,
      type: "BLOOD_PRESSURE_SYS",
      value: t < 0 ? 140 : 130 - 0.1 * t,
      unit: "mmHg",
      source: "MANUAL",
      measuredAt: new Date(PIVOT + t * DAY + 8 * 3_600_000),
    });
  }
  // Two paired diastolic readings and one lone diastolic.
  rows.push(
    {
      userId,
      type: "BLOOD_PRESSURE_DIA",
      value: 85,
      unit: "mmHg",
      source: "MANUAL",
      measuredAt: new Date(PIVOT + 10 * DAY + 8 * 3_600_000),
    },
    {
      userId,
      type: "BLOOD_PRESSURE_DIA",
      value: 84,
      unit: "mmHg",
      source: "MANUAL",
      measuredAt: new Date(PIVOT + 11 * DAY + 8 * 3_600_000),
    },
    {
      userId,
      type: "BLOOD_PRESSURE_DIA",
      value: 80,
      unit: "mmHg",
      source: "MANUAL",
      measuredAt: new Date(PIVOT + 11 * DAY + 20 * 3_600_000),
    },
  );
  rows.push(
    {
      userId,
      type: "BLOOD_GLUCOSE",
      value: 95,
      unit: "mg/dL",
      source: "MANUAL",
      glucoseContext: "FASTING",
      measuredAt: new Date(PIVOT + 12 * DAY),
    },
    {
      userId,
      type: "BLOOD_GLUCOSE",
      value: 130,
      unit: "mg/dL",
      source: "MANUAL",
      glucoseContext: null,
      measuredAt: new Date(PIVOT + 12 * DAY + 3_600_000),
    },
    {
      userId,
      type: "WEIGHT",
      value: 80,
      unit: "kg",
      source: "MANUAL",
      measuredAt: new Date(PIVOT + 13 * DAY),
      deletedAt: new Date(PIVOT + 14 * DAY),
    },
    {
      userId: otherId,
      type: "WEIGHT",
      value: 70,
      unit: "kg",
      source: "MANUAL",
      measuredAt: new Date(PIVOT + 13 * DAY),
    },
  );
  await prisma.measurement.createMany({ data: rows });

  await prisma.workout.createMany({
    data: [
      {
        userId,
        source: "MANUAL",
        sportType: "running",
        externalId: "run-1",
        startedAt: new Date(PIVOT + 11 * DAY + 12 * 3_600_000),
        endedAt: new Date(PIVOT + 11 * DAY + 13 * 3_600_000),
        durationSec: 3600,
        totalDistanceM: 10_000,
        totalEnergyKcal: 700,
        avgHeartRate: 150,
      },
      {
        userId,
        source: "MANUAL",
        sportType: "running",
        externalId: "run-2",
        startedAt: new Date(PIVOT + 20 * DAY),
        endedAt: new Date(PIVOT + 20 * DAY + 1_800_000),
        durationSec: 1800,
      },
    ],
  });

  const med = await prisma.medication.create({
    data: {
      userId,
      name: "Ramipril",
      dose: "5 mg",
      treatmentClass: "GENERIC",
      atcCode: "C09AA05",
      trackIntake: false,
      startsOn: new Date(PIVOT),
    },
  });
  medId = med.id;
  await prisma.medication.create({
    data: {
      userId,
      name: "Second drug",
      dose: "1 mg",
      treatmentClass: "GENERIC",
      startsOn: new Date(PIVOT + 20 * DAY),
    },
  });
});

describe("FHIR Observation series in Postgres", () => {
  const range = {
    from: new Date(PIVOT + 10 * DAY),
    to: new Date(PIVOT + 21 * DAY),
  };

  it("pages newest first, pairs BP, scopes to the owner and drops soft-deleted rows", async () => {
    const scope = resolveSeriesScope(
      gateOf([
        "BLOOD_PRESSURE_SYS",
        "BLOOD_PRESSURE_DIA",
        "BLOOD_GLUCOSE",
        "WEIGHT",
        "WORKOUTS",
      ]),
      null,
    );
    const { total, refs } = await querySeriesPage({
      userId,
      scope,
      range,
      count: 200,
      offset: 0,
    });
    // 11 systolic (days 10..20), 1 lone diastolic, 2 glucose, 2 workouts.
    // The two paired diastolic rows ride inside their systolic panels; the
    // deleted weight and the other account's weight never appear.
    expect(total).toBe(16);
    expect(refs).toHaveLength(16);
    const page = await emitSeriesPage({
      userId,
      refs,
      scope,
      glucoseUnit: "mg/dL",
    });
    expect(page).toHaveLength(16);
    // Newest first: the day-20 systolic (08:00, no diastolic partner, so a
    // lone 8480-6 reading), then the day-20 run (00:00).
    expect(page[0].code.coding?.[0]?.code).toBe("8480-6");
    expect(page[1].id.startsWith("w-")).toBe(true);
    const panels = page.filter(
      (o) =>
        o.code.coding?.[0]?.code === "85354-9" && o.component?.length === 2,
    );
    expect(
      panels.map((p) => p.component?.[1]?.valueQuantity?.value).sort(),
    ).toEqual([84, 85]);
    expect(page.some((o) => o.code.coding?.[0]?.code === "8462-4")).toBe(true);
    expect(page.some((o) => o.code.coding?.[0]?.code === "29463-7")).toBe(
      false,
    );
  });

  it("pages with offset and agrees with the count", async () => {
    const scope = resolveSeriesScope(gateOf(["BLOOD_PRESSURE_SYS"]), null);
    const first = await querySeriesPage({
      userId,
      scope,
      range,
      count: 5,
      offset: 0,
    });
    const second = await querySeriesPage({
      userId,
      scope,
      range,
      count: 5,
      offset: 5,
    });
    expect(first.total).toBe(11);
    expect(first.refs).toHaveLength(5);
    expect(second.refs).toHaveLength(5);
    const ids = new Set([...first.refs, ...second.refs].map((r) => r.id));
    expect(ids.size).toBe(10);
  });

  it("narrows glucose to a code's contexts", async () => {
    const scope = resolveSeriesScope(gateOf(["BLOOD_GLUCOSE"]), {
      types: new Set(["BLOOD_GLUCOSE"]),
      glucoseContexts: new Set(["FASTING"]),
      workouts: false,
    });
    const { total } = await querySeriesPage({
      userId,
      scope,
      range,
      count: 50,
      offset: 0,
    });
    expect(total).toBe(1);
  });
});

describe("segmented medication effect in Postgres", () => {
  it("recovers the known level and slope change and lists the confounder", async () => {
    const prisma = getPrismaClient();
    const med = await prisma.medication.findFirstOrThrow({
      where: { id: medId },
      include: EFFECT_MEDICATION_INCLUDE,
    });
    const effects = await loadSegmentedEffects({
      userId,
      med,
      targets: ["BLOOD_PRESSURE_SYS"],
      timezone: "UTC",
      now: new Date(PIVOT + 59 * DAY + 12 * 3_600_000),
    });
    const e = effects.get("BLOOD_PRESSURE_SYS")!;
    expect(e.present).toBe(true);
    expect(e.levelChange!.estimate).toBeCloseTo(-10, 6);
    expect(e.slopeChangePerWeek!.estimate).toBeCloseTo(-0.7, 6);
    expect(e.days.before).toBe(60);
    expect(e.days.after).toBe(60);
    expect(e.adherence.status).toBe("not_tracked");
    expect(e.confounders).toEqual([
      { medicationName: "Second drug", event: "started", date: "2026-03-21" },
    ]);
  });

  it("reaches the doctor report with its workout block", async () => {
    const data = await collectDoctorReportData(
      userId,
      {
        start: new Date(PIVOT),
        end: new Date(PIVOT + 59 * DAY + 12 * 3_600_000),
        days: 60,
      },
      selectionFromLeaves([
        "MEDICATION_LIST",
        "MEDICATION_EFFECT",
        "BLOOD_PRESSURE_SYS",
        "WORKOUTS",
      ]),
      { moduleMap: MODULES as never },
    );
    const effect = data.medicationEffects?.find(
      (m) => m.medicationName === "Ramipril",
    );
    // Diastolic was not selected, so only the systolic target rides.
    expect(effect?.targets.map((t) => t.type)).toEqual(["BLOOD_PRESSURE_SYS"]);
    expect(effect?.targets[0].effect.present).toBe(true);
    expect(data.workouts?.sessions).toBe(2);
    expect(data.workouts?.bySport[0]).toMatchObject({
      sportType: "running",
      sessions: 2,
      durationSec: 5400,
      distanceM: 10_000,
      distanceSessions: 1,
    });
  });
});
