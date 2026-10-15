/**
 * The day's movement block (`DayMovement`), resolved for every reader of a
 * day: the web view, the native client, and through the model projection the
 * Coach and the MCP endpoint.
 *
 * Distances leave in the account's unit, to one decimal; a client renders
 * them as they come. A null field means "no coverage that day", never zero.
 */
import type { DayResponse } from "@/lib/day/contract";
import { prisma } from "@/lib/db";

import { openDayCountry } from "./connection";

type DayMovement = NonNullable<DayResponse["movement"]>;

const METRES_PER_MILE = 1609.344;

/** Metres in the account's unit, to one decimal. */
export function distanceInUnit(
  metres: number | null,
  unit: "km" | "mi",
): number | null {
  if (metres === null) return null;
  const value = unit === "mi" ? metres / METRES_PER_MILE : metres / 1000;
  return Math.round(value * 10) / 10;
}

/**
 * The movement block for one day, `undefined` when the record has no Dawarich
 * connection (the field is then left off), null when it has one but no values
 * for the day.
 */
export async function readDayMovement(
  userId: string,
  day: string,
): Promise<DayMovement | null | undefined> {
  const [user, row] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { dawarichUrlEncrypted: true, unitPreference: true },
    }),
    prisma.dawarichDay.findUnique({
      where: { userId_date: { userId, date: day } },
      select: {
        totalDistanceM: true,
        drivingDistanceM: true,
        trainDistanceM: true,
        placesVisited: true,
        awayFromHomeMinutes: true,
        countryCodeEncrypted: true,
        isTravelDay: true,
        fetchedAt: true,
      },
    }),
  ]);
  if (!user?.dawarichUrlEncrypted) return undefined;
  if (!row) return null;
  const unit = user.unitPreference === "imperial" ? "mi" : "km";
  return {
    source: "dawarich",
    distance: {
      unit,
      total: distanceInUnit(row.totalDistanceM, unit),
      driving: distanceInUnit(row.drivingDistanceM, unit),
      train: distanceInUnit(row.trainDistanceM, unit),
    },
    placesVisited: row.placesVisited,
    awayFromHomeMinutes: row.awayFromHomeMinutes,
    travel:
      row.isTravelDay === null
        ? null
        : {
            isTravelDay: row.isTravelDay,
            countryCode: openDayCountry(row.countryCodeEncrypted),
          },
    fetchedAt: row.fetchedAt.toISOString(),
  };
}
