/**
 * The write-path hook every dose mutation funnels through: after a dose of a
 * medication was taken, skipped, corrected, deleted, undone or recorded
 * automatically, the rows derived from that dose's local day are recomputed.
 *
 * Today that is one derived row family, the micronutrients a taken
 * supplement dose adds (`refreshSupplementNutrientsForDose`). The hook used to
 * upsert a per-day compliance rollup as well; that table had no reader left
 * and was dropped, so this is what remains of it, under a name that says what
 * it does.
 *
 * Best-effort, like every derived row: a failure is reported by the refresh
 * itself and never fails the dose write.
 */
import { refreshSupplementNutrientsForDose } from "@/lib/medications/ingredients/recompute";
import { DEFAULT_TIMEZONE, isValidTimezone, userDayKey } from "@/lib/tz/format";

function safeTimezone(tz: string | null | undefined): string {
  return tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
}

/**
 * The account-local day (`YYYY-MM-DD`) a dose slot belongs to: the local day
 * of its `scheduledFor` in the account's timezone, falling back to the server
 * default for a missing or unknown zone.
 */
export function dayKeyForScheduledFor(
  scheduledFor: Date,
  tz: string | null | undefined,
): string {
  return userDayKey(scheduledFor, safeTimezone(tz));
}

/** Refresh the derived rows of one medication's local day. */
export async function refreshDoseDay(input: {
  userId: string;
  medicationId: string;
  dayKey: string;
  tz: string | null | undefined;
}): Promise<void> {
  await refreshSupplementNutrientsForDose({
    userId: input.userId,
    medicationId: input.medicationId,
    dayKey: input.dayKey,
    timezone: safeTimezone(input.tz),
  });
}

/** Refresh the derived rows of the local day a dose slot sits on. */
export async function refreshDoseSlot(input: {
  userId: string;
  medicationId: string;
  scheduledFor: Date;
  tz: string | null | undefined;
}): Promise<void> {
  await refreshDoseDay({
    userId: input.userId,
    medicationId: input.medicationId,
    dayKey: dayKeyForScheduledFor(input.scheduledFor, input.tz),
    tz: input.tz,
  });
}
