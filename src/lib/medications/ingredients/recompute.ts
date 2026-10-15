/**
 * v1.43 — supplement doses to micronutrients.
 *
 * A medication with a stored composition (`MedicationIngredient`) adds, for
 * every dose that was taken, `amountPerUnit × unitsPerDose` of each
 * ingredient to the day's `NutrientIntakeDay` row with `source = SUPPLEMENT`.
 *
 * The row is RECOMPUTED, never incremented: each pass reads the taken doses
 * of a day (or of the whole history), sums them, and replaces the day's
 * SUPPLEMENT rows with the sum. That is what makes every path idempotent and
 * self-correcting — a dose marked taken twice, a correction, an undo, a
 * deleted dose, a changed composition all converge on the same rows the next
 * pass computes, and a day left with no contribution loses its row.
 *
 * Which doses count: live rows (`deletedAt` null) with `takenAt` set that are
 * neither skipped nor auto-missed; an automatically recorded dose counts.
 * Rows sharing one `(medication, scheduledFor)` slot (a reminder row and an
 * API row for the same dose) count once, the way the compliance rollup folds
 * them. A dose belongs to the local day of its `scheduledFor` in the account's
 * timezone, the same day the dose list and the compliance rollup put it on.
 * The units per dose resolve per slot exactly as the inventory consumption
 * does (`resolveUnitsPerDose`), so a half tablet at noon counts as half.
 *
 * Module `nutrients` off: nothing is written and existing rows are left as
 * they are, like the other sources' rows.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { annotate } from "@/lib/logging/context";
import { resolveUnitsPerDose } from "@/lib/medications/inventory/consumption";
import { isModuleEnabled } from "@/lib/modules/gate";
import { NUTRIENT_CATALOG, isNutrientCode } from "@/lib/nutrients/catalog";
import { NUTRIENT_SOURCE } from "@/lib/nutrients/sources";
import { DEFAULT_TIMEZONE, isValidTimezone, userDayKey } from "@/lib/tz/format";
import { localDayWindow } from "@/lib/tz/local-day";

type Tx = Prisma.TransactionClient;

/** One supplement nutrient row as the pass writes it. */
export interface SupplementNutrientRow {
  day: string;
  nutrient: string;
  amount: number;
  unit: string;
}

/** A taken dose slot of a medication that has a composition. */
export interface TakenSupplementSlot {
  medicationId: string;
  scheduledFor: Date;
}

/** What the pass needs to know about each medication with a composition. */
export interface SupplementMedication {
  id: string;
  unitsPerDose: Prisma.Decimal;
  schedules: ReadonlyArray<{
    timesOfDay: string[];
    windowStart: string;
    unitsPerDose: Prisma.Decimal | null;
  }>;
  ingredients: ReadonlyArray<{
    nutrient: string;
    amountPerUnit: number;
  }>;
}

function safeTimezone(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/** Round away binary noise from the sums (25 × 2 stays 50). */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * Sum taken slots into day rows. Pure. Duplicate rows of one slot count once;
 * an ingredient whose code fell out of the catalogue is skipped rather than
 * written under a unit nobody can vouch for.
 */
export function supplementNutrientRows(
  slots: ReadonlyArray<TakenSupplementSlot>,
  medications: ReadonlyArray<SupplementMedication>,
  timezone: string,
): SupplementNutrientRow[] {
  const byId = new Map(medications.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const sums = new Map<string, SupplementNutrientRow>();

  for (const slot of slots) {
    const slotKey = `${slot.medicationId}|${slot.scheduledFor.getTime()}`;
    if (seen.has(slotKey)) continue;
    seen.add(slotKey);
    const medication = byId.get(slot.medicationId);
    if (!medication || medication.ingredients.length === 0) continue;

    const units = resolveUnitsPerDose({
      scheduledFor: slot.scheduledFor,
      timeZone: timezone,
      medicationUnitsPerDose: medication.unitsPerDose,
      schedules: medication.schedules,
    });
    if (!(units > 0)) continue;
    const day = userDayKey(slot.scheduledFor, timezone);

    for (const ingredient of medication.ingredients) {
      if (!isNutrientCode(ingredient.nutrient)) continue;
      const key = `${day}|${ingredient.nutrient}`;
      const row = sums.get(key) ?? {
        day,
        nutrient: ingredient.nutrient,
        amount: 0,
        unit: NUTRIENT_CATALOG[ingredient.nutrient].unit,
      };
      row.amount += ingredient.amountPerUnit * units;
      sums.set(key, row);
    }
  }

  return [...sums.values()]
    .map((row) => ({ ...row, amount: round(row.amount) }))
    .filter((row) => row.amount > 0)
    .sort((a, b) =>
      a.day === b.day
        ? a.nutrient.localeCompare(b.nutrient)
        : a.day.localeCompare(b.day),
    );
}

/** Serialise every pass for one account (transaction-scoped). */
async function lockAccount(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtextextended(${`supplement-nutrients:${userId}`}, 0))) AS lock`;
}

async function loadSupplementMedications(
  tx: Tx,
  userId: string,
): Promise<SupplementMedication[]> {
  return tx.medication.findMany({
    where: { userId, ingredients: { some: {} } },
    select: {
      id: true,
      unitsPerDose: true,
      schedules: {
        select: { timesOfDay: true, windowStart: true, unitsPerDose: true },
      },
      ingredients: { select: { nutrient: true, amountPerUnit: true } },
    },
  });
}

async function loadTakenSlots(
  tx: Tx,
  userId: string,
  medicationIds: string[],
  window: { start: Date; end: Date } | null,
): Promise<TakenSupplementSlot[]> {
  if (medicationIds.length === 0) return [];
  return tx.medicationIntakeEvent.findMany({
    where: {
      userId,
      medicationId: { in: medicationIds },
      deletedAt: null,
      takenAt: { not: null },
      skipped: false,
      autoMissed: false,
      ...(window
        ? { scheduledFor: { gte: window.start, lt: window.end } }
        : {}),
    },
    select: { medicationId: true, scheduledFor: true },
  });
}

async function writeRows(
  tx: Tx,
  userId: string,
  rows: SupplementNutrientRow[],
): Promise<void> {
  if (rows.length === 0) return;
  await tx.nutrientIntakeDay.createMany({
    data: rows.map((row) => ({
      userId,
      day: row.day,
      nutrient: row.nutrient,
      amount: row.amount,
      unit: row.unit,
      source: NUTRIENT_SOURCE.SUPPLEMENT,
    })),
  });
}

export interface SupplementRecomputeResult {
  /** False when the module is off and nothing was touched. */
  ran: boolean;
  rowsWritten: number;
}

/**
 * Recompute one local day's SUPPLEMENT rows for the account, across every
 * medication with a composition.
 */
export async function recomputeSupplementNutrientsForDay(
  userId: string,
  dayKey: string,
  timezone: string | null | undefined,
): Promise<SupplementRecomputeResult> {
  if (!(await isModuleEnabled(userId, "nutrients"))) {
    return { ran: false, rowsWritten: 0 };
  }
  const tz = safeTimezone(timezone);
  const { dayStart, dayEnd } = localDayWindow(dayKey, tz);
  return prisma.$transaction(async (tx) => {
    await lockAccount(tx, userId);
    const medications = await loadSupplementMedications(tx, userId);
    const slots = await loadTakenSlots(
      tx,
      userId,
      medications.map((m) => m.id),
      { start: dayStart, end: dayEnd },
    );
    // A slot near midnight is read by its UTC window; the local-day filter
    // keeps exactly the day asked for.
    const rows = supplementNutrientRows(slots, medications, tz).filter(
      (row) => row.day === dayKey,
    );
    await tx.nutrientIntakeDay.deleteMany({
      where: { userId, day: dayKey, source: NUTRIENT_SOURCE.SUPPLEMENT },
    });
    await writeRows(tx, userId, rows);
    return { ran: true, rowsWritten: rows.length };
  });
}

/**
 * Recompute every SUPPLEMENT row of the account over the whole history: after
 * a composition changes, a medication or its doses are deleted, or an import
 * lands. Bounded by the account's own taken doses of medications that have a
 * composition, which is a few thousand rows for years of a daily supplement.
 */
export async function recomputeSupplementNutrientsForUser(
  userId: string,
): Promise<SupplementRecomputeResult> {
  if (!(await isModuleEnabled(userId, "nutrients"))) {
    return { ran: false, rowsWritten: 0 };
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (!user) return { ran: false, rowsWritten: 0 };
  const tz = safeTimezone(user.timezone);
  return prisma.$transaction(
    async (tx) => {
      await lockAccount(tx, userId);
      const medications = await loadSupplementMedications(tx, userId);
      const slots = await loadTakenSlots(
        tx,
        userId,
        medications.map((m) => m.id),
        null,
      );
      const rows = supplementNutrientRows(slots, medications, tz);
      await tx.nutrientIntakeDay.deleteMany({
        where: { userId, source: NUTRIENT_SOURCE.SUPPLEMENT },
      });
      await writeRows(tx, userId, rows);
      return { ran: true, rowsWritten: rows.length };
    },
    { timeout: 60_000 },
  );
}

/**
 * The write-path hook: after a dose of `medicationId` on `dayKey` changed
 * (taken, skipped, corrected, deleted, undone, recorded automatically).
 * Cheap when the medication has no composition, which is almost always: one
 * indexed existence read and nothing else. Best-effort, like every derived
 * row: a failure is reported and never fails the dose write.
 */
export async function refreshSupplementNutrientsForDose(input: {
  userId: string;
  medicationId: string;
  dayKey: string;
  timezone: string | null | undefined;
}): Promise<void> {
  try {
    const hasComposition = await prisma.medicationIngredient.findFirst({
      where: { medicationId: input.medicationId, userId: input.userId },
      select: { id: true },
    });
    if (!hasComposition) return;
    await recomputeSupplementNutrientsForDay(
      input.userId,
      input.dayKey,
      input.timezone,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    annotate({
      meta: {
        supplement_nutrient_refresh_failed: true,
        supplement_nutrient_refresh_error: message,
      },
    });
    console.error("[supplement-nutrients] day refresh failed:", message);
  }
}
