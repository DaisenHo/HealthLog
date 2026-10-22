/**
 * A randomly generated account survives a disaster-recovery backup and
 * restore unchanged.
 *
 * `backup-round-trip.test.ts` proves one hand-seeded row of every model and
 * one value of every column. This file generates whole accounts instead:
 * measurements of mixed types and sources, medications with weekly and daily
 * schedules and intake histories, mood entries, and a handful of settings, in
 * combinations nobody wrote down. Each account is exported the way the weekly
 * worker exports it, the account is deleted and recreated under the same id,
 * the file is restored through the operator's restore route, and a canonical
 * dump of every generated table must come back identical.
 *
 * Seeded like every property test (tests/property/fast-check.ts); a failure
 * prints the seed and the smallest account that still fails.
 */
import fc from "fast-check";
import { beforeEach, describe, expect, it } from "vitest";

import { legacyStreamedBlobFrom } from "@/__tests__/helpers/legacy-backup-blob";
import type { Prisma } from "@/generated/prisma/client";
import { streamFullBackupJson } from "@/lib/export/full-backup-stream";

import { assertAsyncProperty, propertyTimeout } from "../property/fast-check";
import { callRoute } from "../kit/call-route";
import { makeAdmin, makeSession, makeUser } from "../kit/factories";
import { POST as restoreBackup } from "./restore-job-driver";
import { getPrismaClient, truncateAllTables } from "./setup";

const prisma = getPrismaClient();
const OWNER_ID = "random-account-owner";

const MEASUREMENTS: ReadonlyArray<{
  type: Prisma.MeasurementCreateManyInput["type"];
  unit: string;
  min: number;
  max: number;
}> = [
  { type: "WEIGHT", unit: "kg", min: 40, max: 160 },
  { type: "BLOOD_PRESSURE_SYS", unit: "mmHg", min: 90, max: 190 },
  { type: "BLOOD_PRESSURE_DIA", unit: "mmHg", min: 50, max: 120 },
  { type: "PULSE", unit: "bpm", min: 40, max: 180 },
  { type: "BLOOD_GLUCOSE", unit: "mg/dL", min: 50, max: 300 },
  { type: "ACTIVITY_STEPS", unit: "steps", min: 0, max: 30_000 },
];
const SOURCES = ["MANUAL", "WITHINGS", "APPLE_HEALTH", "IMPORT"] as const;

const instant = fc
  .integer({
    min: Date.parse("2024-01-01T00:00:00Z") / 60_000,
    max: Date.parse("2026-09-30T00:00:00Z") / 60_000,
  })
  .map((minutes) => new Date(minutes * 60_000));

const measurementArb = fc.record({
  kind: fc.nat({ max: MEASUREMENTS.length - 1 }),
  source: fc.constantFrom(...SOURCES),
  measuredAt: instant,
  fraction: fc.double({ min: 0, max: 1, noNaN: true }),
  externalId: fc.option(fc.uuid(), { nil: null }),
});

const scheduleArb = fc.oneof(
  fc.record({
    windowStart: fc.constantFrom("07:00", "08:00", "20:00"),
    daysOfWeek: fc.constantFrom(null, "1,3,5", "0,6"),
    rrule: fc.constant(null),
    timesOfDay: fc.constant<string[]>([]),
  }),
  fc.record({
    windowStart: fc.constantFrom("06:30", "12:00"),
    daysOfWeek: fc.constant(null),
    rrule: fc.constantFrom("FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,TH"),
    timesOfDay: fc.uniqueArray(fc.constantFrom("06:30", "12:00", "21:15"), {
      minLength: 1,
      maxLength: 2,
    }),
  }),
);

const intakeArb = fc.record({
  scheduledFor: instant,
  outcome: fc.constantFrom("taken", "skipped", "missed"),
});

const medicationArb = fc.record({
  name: fc.constantFrom("Ramipril", "Metformin", "Vitamin D", "Levothyroxin"),
  dose: fc.constantFrom("5mg", "500mg", "1000 IE", "50µg"),
  asNeeded: fc.boolean(),
  active: fc.boolean(),
  schedules: fc.array(scheduleArb, { minLength: 1, maxLength: 2 }),
  intakes: fc.uniqueArray(intakeArb, {
    maxLength: 5,
    selector: (i) => i.scheduledFor.getTime(),
  }),
});

const MOODS = [
  ["SUPER_GUT", 5],
  ["GUT", 4],
  ["OKAY", 3],
  ["SCHLECHT", 2],
  ["LAUSIG", 1],
] as const;

const moodArb = fc.record({
  loggedAt: instant,
  level: fc.nat({ max: 4 }),
  dims: fc.option(fc.tuple(fc.nat({ max: 10 }), fc.nat({ max: 10 })), {
    nil: null,
  }),
});

const settingsArb = fc.record(
  {
    unitPreference: fc.constantFrom("metric", "imperial"),
    glucoseUnit: fc.constantFrom("mg/dL", "mmol/L"),
    timezone: fc.constantFrom(
      "Europe/Berlin",
      "America/New_York",
      "Asia/Kolkata",
    ),
    heightCm: fc.integer({ min: 140, max: 210 }),
    hasDiabetes: fc.boolean(),
  },
  { requiredKeys: [] },
);

const accountArb = fc.record({
  measurements: fc.uniqueArray(measurementArb, {
    maxLength: 25,
    selector: (m) => `${m.kind}|${m.source}|${m.measuredAt.getTime()}`,
  }),
  medications: fc.array(medicationArb, { maxLength: 3 }),
  moods: fc.uniqueArray(moodArb, {
    maxLength: 6,
    selector: (m) => m.loggedAt.toISOString().slice(0, 10),
  }),
  settings: settingsArb,
});

type Account = typeof accountArb extends fc.Arbitrary<infer T> ? T : never;

async function seed(account: Account): Promise<void> {
  await makeUser({ id: OWNER_ID, ...account.settings });
  await prisma.measurement.createMany({
    data: account.measurements.map((m) => {
      const kind = MEASUREMENTS[m.kind];
      const value =
        Math.round((kind.min + m.fraction * (kind.max - kind.min)) * 10) / 10;
      return {
        userId: OWNER_ID,
        type: kind.type,
        unit: kind.unit,
        value,
        source: m.source,
        measuredAt: m.measuredAt,
        externalId: m.externalId,
      };
    }),
  });
  for (const med of account.medications) {
    const created = await prisma.medication.create({
      data: {
        userId: OWNER_ID,
        name: med.name,
        dose: med.dose,
        asNeeded: med.asNeeded,
        active: med.active,
        schedules: {
          create: med.schedules.map((s) => ({
            windowStart: s.windowStart,
            windowEnd: s.windowStart,
            daysOfWeek: s.daysOfWeek,
            rrule: s.rrule,
            timesOfDay: s.timesOfDay,
          })),
        },
      },
    });
    await prisma.medicationIntakeEvent.createMany({
      data: med.intakes.map((i) => ({
        userId: OWNER_ID,
        medicationId: created.id,
        scheduledFor: i.scheduledFor,
        takenAt:
          i.outcome === "taken"
            ? new Date(i.scheduledFor.getTime() + 600_000)
            : null,
        skipped: i.outcome === "skipped",
      })),
    });
  }
  await prisma.moodEntry.createMany({
    data: account.moods.map((m) => {
      const [mood, score] = MOODS[m.level];
      return {
        userId: OWNER_ID,
        date: m.loggedAt.toISOString().slice(0, 10),
        mood,
        score,
        moodLoggedAt: m.loggedAt,
        tz: "UTC",
        moodA1: m.dims?.[0] ?? null,
        stressA2: m.dims?.[1] ?? null,
      };
    }),
  });
}

/**
 * Columns a restore legitimately rewrites: the bookkeeping Prisma stamps on
 * every write, and the per-row sync counters the restore bumps so a paired
 * client re-reads the rows.
 */
const VOLATILE = new Set(["updatedAt", "syncedAt", "syncVersion"]);

function canonical(rows: ReadonlyArray<object>): string[] {
  return rows
    .map((row) =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(row)
            .filter(([key]) => !VOLATILE.has(key))
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [
              key,
              value instanceof Date ? value.toISOString() : value,
            ]),
        ),
      ),
    )
    .sort();
}

async function dump(): Promise<Record<string, string[]>> {
  const where = { userId: OWNER_ID };
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: OWNER_ID },
    select: {
      unitPreference: true,
      glucoseUnit: true,
      timezone: true,
      heightCm: true,
      hasDiabetes: true,
    },
  });
  return {
    user: canonical([user]),
    measurements: canonical(await prisma.measurement.findMany({ where })),
    medications: canonical(await prisma.medication.findMany({ where })),
    schedules: canonical(
      await prisma.medicationSchedule.findMany({
        where: { medication: where },
      }),
    ),
    intakes: canonical(await prisma.medicationIntakeEvent.findMany({ where })),
    moods: canonical(await prisma.moodEntry.findMany({ where })),
  };
}

beforeEach(async () => {
  await truncateAllTables(prisma);
});

describe("a generated account", () => {
  it(
    "comes back from a disaster-recovery backup exactly as it left",
    async () => {
      await assertAsyncProperty(
        fc.asyncProperty(accountArb, async (account) => {
          await truncateAllTables(prisma);
          await seed(account);
          const before = await dump();

          let json = "";
          await streamFullBackupJson(
            prisma,
            OWNER_ID,
            (chunk) => {
              json += chunk;
            },
            {
              purpose: "disaster-recovery",
              exportedAt: new Date("2026-10-01T00:00:00.000Z"),
            },
          );

          await prisma.user.delete({ where: { id: OWNER_ID } });
          await makeUser({ id: OWNER_ID });
          const backup = await prisma.dataBackup.create({
            data: {
              userId: OWNER_ID,
              type: "RANDOM_ACCOUNT_ROUND_TRIP",
              data: await legacyStreamedBlobFrom(async (write) => {
                await write(json);
              }),
            },
          });
          const operator = await makeSession(await makeAdmin());
          const restored = await callRoute(restoreBackup, {
            method: "POST",
            route: "/api/admin/backups/{id}/restore",
            params: { id: backup.id },
            body: { confirm: "RESTORE" },
            auth: operator,
            contract: {
              skip: "the restore driver answers 200 with the job's report in place of the route's queued 202",
            },
          });
          expect(
            restored.status,
            JSON.stringify(restored.body).slice(0, 300),
          ).toBe(200);

          expect(await dump()).toEqual(before);
        }),
        12,
      );
      // Twelve round trips take a few seconds; the nightly factor multiplies
      // both the cases and this budget.
    },
    propertyTimeout(60_000),
  );
});
