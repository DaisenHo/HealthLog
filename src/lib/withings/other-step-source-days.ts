/**
 * The days an account's steps already reach HealthLog from a source other
 * than Withings.
 *
 * Getactivity marks a day Health Mate holds from another app with brand 18
 * ("external"). When that app also reaches HealthLog through its own
 * integration (Apple Health, Health Connect, a wearable), the Withings copy is
 * a duplicate under the wrong name and the sync skips it. When nothing else
 * delivered steps that day, Health Mate is the account's only way in for
 * them (a phone whose steps are read only by Health Mate), and skipping the
 * day would lose it. This answers which of the two each day is.
 *
 * Decided per local day in the account's zone, from live rows of any
 * connected source: a hand-entered step count is not a connected source and
 * does not make the Withings day a duplicate.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { dayKeyAsUtcMidnight } from "@/lib/tz/date-only";
import { shiftDateKey } from "@/lib/tz/format";

export async function daysWithOtherStepSource(
  userId: string,
  dateKeys: readonly string[],
  timeZone: string,
  db: Pick<PrismaClient, "$queryRaw"> = defaultPrisma,
): Promise<Set<string>> {
  if (dateKeys.length === 0) return new Set();
  const sorted = [...dateKeys].sort();
  // A day's local midnight lies within a day of its UTC midnight in every
  // zone, so a one-day margin on each side bounds the index range.
  const from = dayKeyAsUtcMidnight(shiftDateKey(sorted[0], -1));
  const to = dayKeyAsUtcMidnight(shiftDateKey(sorted[sorted.length - 1], 2));
  const rows = await db.$queryRaw<Array<{ day: string }>>`
    SELECT DISTINCT
      to_char((m."measured_at" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day
    FROM "measurements" m
    WHERE m."user_id" = ${userId}
      AND m."type" = 'ACTIVITY_STEPS'
      AND m."source" NOT IN ('WITHINGS', 'MANUAL')
      AND m."deleted_at" IS NULL
      AND m."measured_at" >= ${from}
      AND m."measured_at" < ${to}
  `;
  const wanted = new Set(dateKeys);
  return new Set(rows.map((r) => r.day).filter((day) => wanted.has(day)));
}
