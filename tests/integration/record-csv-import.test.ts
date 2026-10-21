/**
 * The lab and medication CSV imports against a real Postgres (#1215).
 *
 *   - a dry run writes nothing (no reading, no marker, no medication) and
 *     reports what the real run then does;
 *   - names resolve to existing markers, new analytes mint one marker each,
 *     a reading in another unit is converted and keeps what the file said;
 *   - re-uploading the same file writes nothing: every row is a duplicate;
 *   - a refused row is reported by line and does not stop the rest;
 *   - medications take a daily schedule, reminders off, as-needed without
 *     schedule, and a dated window opens a course.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

import { getPrismaClient, truncateAllTables } from "./setup";
import { textToStream } from "@/lib/import/csv-stream";
import { importLabsCsv } from "@/lib/import/labs-csv";
import { importMedicationsCsv } from "@/lib/import/medications-csv";
import {
  labsCsvQuerySchema,
  medicationsCsvQuerySchema,
} from "@/lib/validations/record-import";

vi.mock("@/lib/db-compat", () => ({
  ensureDbCompatibility: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/jobs/boss-instance", () => ({
  getGlobalBoss: vi.fn(() => null),
}));

const prisma = getPrismaClient();
const USER = "csv-import-user";
const TZ = "Europe/Berlin";

const LABS = [
  "Analyt;Wert;Einheit;Datum;Referenz",
  "Glucose;5,5;mmol/L;01.03.2025;3,9 - 5,5",
  "Glukose;99;mg/dL;02.03.2025;",
  "HbA1c;5,4;%;01.03.2025;4,0-5,6",
  "Urinstatus Eiweiß;negativ;;01.03.2025;",
  "Ferritin;1.234;ng/mL;01.03.2025;",
  "Ferritin;85;;01.03.2025;",
  "Neuer Marker;12;U/l;03.03.2025;",
].join("\n");

function labsQuery(dryRun: boolean) {
  return labsCsvQuerySchema.parse({
    analyte: "0",
    value: "1",
    unit: "2",
    date: "3",
    referenceRange: "4",
    decimal: "comma",
    dateOrder: "dmy",
    dryRun: dryRun ? "1" : "0",
  });
}

beforeAll(async () => {
  await truncateAllTables(prisma);
  await prisma.user.create({
    data: { id: USER, username: USER, timezone: TZ },
  });
  await prisma.biomarker.create({
    // No analyte key stored: the import derives it the way the write does.
    data: { userId: USER, name: "Glucose", unit: "mg/dL" },
  });
  await prisma.biomarkerAlias.create({
    data: {
      userId: USER,
      biomarkerId: (
        await prisma.biomarker.findFirstOrThrow({ where: { userId: USER } })
      ).id,
      name: "Glukose",
      nameFolded: "glukose",
      source: "MANUAL",
    },
  });
});

describe("lab CSV import", () => {
  it("a dry run writes nothing and reports the plan", async () => {
    const result = await importLabsCsv({
      userId: USER,
      tz: TZ,
      stream: textToStream(LABS, 16),
      maxBytes: 1_000_000,
      query: labsQuery(true),
    });
    expect(result).toMatchObject({
      rows: 7,
      valid: 5,
      inserted: 5,
      failed: 2,
      duplicates: 0,
    });
    expect(result.errors).toEqual([
      { line: 6, reason: "ambiguous_number", field: "value" },
      { line: 7, reason: "missing_unit", field: "unit" },
    ]);
    expect(result.markers?.created.sort()).toEqual([
      "HbA1c",
      "Neuer Marker",
      "Urinstatus Eiweiß",
    ]);
    expect(result.markers?.matched.map((m) => m.how).sort()).toEqual([
      "alias",
      "name",
    ]);
    expect(await prisma.labResult.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.biomarker.count({ where: { userId: USER } })).toBe(1);
  });

  it("the import converts, mints and keeps what the file said", async () => {
    const result = await importLabsCsv({
      userId: USER,
      tz: TZ,
      stream: textToStream(LABS, 16),
      maxBytes: 1_000_000,
      query: labsQuery(false),
    });
    expect(result).toMatchObject({ inserted: 5, failed: 2 });
    const glucose = await prisma.labResult.findMany({
      where: { userId: USER, analyte: "Glucose" },
      orderBy: { takenAt: "asc" },
    });
    expect(glucose).toHaveLength(2);
    expect(glucose[0].unit).toBe("mg/dL");
    expect(glucose[0].value).toBeCloseTo(99.1, 0);
    expect(glucose[0].sourceValue).toBe(5.5);
    expect(glucose[0].sourceUnit).toBe("mmol/L");
    expect(glucose[0].source).toBe("IMPORT");
    expect(glucose[1].value).toBe(99);
    const text = await prisma.labResult.findFirstOrThrow({
      where: { userId: USER, valueText: "negativ" },
    });
    expect(text.value).toBeNull();
    expect(await prisma.biomarker.count({ where: { userId: USER } })).toBe(4);
  });

  it("re-uploading the same file writes nothing", async () => {
    const before = await prisma.labResult.count({ where: { userId: USER } });
    const result = await importLabsCsv({
      userId: USER,
      tz: TZ,
      stream: textToStream(LABS, 7),
      maxBytes: 1_000_000,
      query: labsQuery(false),
    });
    expect(result).toMatchObject({ inserted: 0, duplicates: 5, failed: 2 });
    expect(await prisma.labResult.count({ where: { userId: USER } })).toBe(
      before,
    );
  });

  it("refuses a unit that does not convert into the marker's", async () => {
    const result = await importLabsCsv({
      userId: USER,
      tz: TZ,
      stream: textToStream(
        "Analyt;Wert;Einheit;Datum\nGlucose;7;mmHg;05.03.2025\n",
      ),
      maxBytes: 1_000_000,
      query: labsCsvQuerySchema.parse({
        analyte: "0",
        value: "1",
        unit: "2",
        date: "3",
        decimal: "comma",
        dateOrder: "dmy",
      }),
    });
    expect(result.errors).toEqual([
      { line: 2, reason: "unit_mismatch", field: "unit" },
    ]);
  });
});

describe("medication CSV import", () => {
  const MEDS = [
    "name,dose,times,as needed,start,end",
    "Ramipril,5 mg,08:00,,2025-01-01,",
    "Metformin,500 mg,08:00 20:00,,,",
    "Ibuprofen,400 mg,,yes,,",
    "Vitamin D,1000 IE,,,,",
    "ramipril,5 MG,08:00,,,",
  ].join("\n");
  const query = (dryRun: boolean) =>
    medicationsCsvQuerySchema.parse({
      name: "0",
      dose: "1",
      times: "2",
      asNeeded: "3",
      startsOn: "4",
      endsOn: "5",
      dryRun: dryRun ? "1" : "0",
    });

  it("checks, then imports, then skips everything on a second upload", async () => {
    const dry = await importMedicationsCsv({
      userId: USER,
      tz: TZ,
      stream: textToStream(MEDS),
      maxBytes: 100_000,
      query: query(true),
    });
    expect(dry).toMatchObject({
      rows: 5,
      inserted: 3,
      duplicates: 1,
      failed: 1,
    });
    expect(dry.errors).toEqual([
      { line: 5, reason: "missing_times", field: "times" },
      { line: 6, reason: "duplicate" },
    ]);
    expect(await prisma.medication.count({ where: { userId: USER } })).toBe(0);

    const real = await importMedicationsCsv({
      userId: USER,
      tz: TZ,
      stream: textToStream(MEDS),
      maxBytes: 100_000,
      query: query(false),
    });
    expect(real).toMatchObject({ inserted: 3, duplicates: 1, failed: 1 });
    const meds = await prisma.medication.findMany({
      where: { userId: USER },
      include: { schedules: true, courses: true },
      orderBy: { name: "asc" },
    });
    const byName = new Map(meds.map((m) => [m.name, m]));
    expect(byName.get("Metformin")?.schedules[0]).toMatchObject({
      rrule: "FREQ=DAILY",
      timesOfDay: ["08:00", "20:00"],
    });
    expect(byName.get("Metformin")?.notificationsEnabled).toBe(false);
    expect(byName.get("Ibuprofen")).toMatchObject({ asNeeded: true });
    expect(byName.get("Ibuprofen")?.schedules).toHaveLength(0);
    expect(byName.get("Ramipril")?.courses).toHaveLength(1);

    const again = await importMedicationsCsv({
      userId: USER,
      tz: TZ,
      stream: textToStream(MEDS),
      maxBytes: 100_000,
      query: query(false),
    });
    expect(again).toMatchObject({ inserted: 0, duplicates: 4 });
  });
});
