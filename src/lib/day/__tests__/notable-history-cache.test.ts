/**
 * The day view's comparison history is read once per record, zone, ladder
 * and readable type set, and each day takes its own slice of it.
 *
 * Paging from one day to the next used to read the same two years again.
 * The slice has to give exactly what a live read of the window would: the
 * extremes depend on where the series starts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readLocalDailyStats = vi.fn();
vi.mock("@/lib/day/daily-stats", () => ({
  readLocalDailyStats: (...a: unknown[]) => readLocalDailyStats(...a),
}));
vi.mock("@/lib/db", () => ({
  prisma: { $queryRaw: vi.fn(async () => []) },
}));

import type { MeasurementType } from "@/generated/prisma/enums";
import { __resetAllCachesForTests } from "@/lib/cache/server-cache";
import { shiftDateKey, userDayKey } from "@/lib/tz/format";

import {
  NOTABLE_LOOKBACK_DAYS,
  extremesInSeries,
  loadNotableRange,
} from "../notable";

const TZ = "Europe/Berlin";
const TODAY = userDayKey(new Date(), TZ);
const SPIKE = shiftDateKey(TODAY, -20);
const FIRST = shiftDateKey(TODAY, -900);

/** Systolic 120 every day from FIRST to TODAY, 150 on SPIKE. */
function value(day: string): number {
  return day === SPIKE ? 150 : 120;
}

beforeEach(() => {
  __resetAllCachesForTests();
  readLocalDailyStats.mockReset();
  readLocalDailyStats.mockImplementation(
    async (args: { types: MeasurementType[]; from: Date; to: Date }) => {
      const days = new Map<string, number>();
      const end = userDayKey(args.to, TZ);
      for (
        let day = userDayKey(args.from, TZ);
        day < end;
        day = shiftDateKey(day, 1)
      ) {
        if (day >= FIRST && day <= TODAY) days.set(day, value(day));
      }
      return new Map(
        args.types
          .filter((t) => t === "BLOOD_PRESSURE_SYS")
          .map((t) => [t, days]),
      );
    },
  );
});

function load(day: string, extra: { floor?: Date } = {}) {
  return loadNotableRange({
    userId: "user-1",
    from: day,
    to: day,
    tz: TZ,
    priorityJson: null,
    typeVisible: (t) => t !== "BLOOD_GLUCOSE",
    gaps: false,
    extremeTypes: ["BLOOD_PRESSURE_SYS"],
    firstValueTypes: [],
    ...extra,
  });
}

/** What a live read of the window gives. */
function expected(day: string) {
  const series: Array<[string, number]> = [];
  for (
    let d = shiftDateKey(day, -NOTABLE_LOOKBACK_DAYS);
    d <= day;
    d = shiftDateKey(d, 1)
  ) {
    if (d >= FIRST) series.push([d, value(d)]);
  }
  return extremesInSeries("BLOOD_PRESSURE_SYS", series, day);
}

describe("notable history cache", () => {
  it("reads the history once while paging through neighbouring days", async () => {
    const spike = await load(SPIKE);
    const before = await load(shiftDateKey(SPIKE, -1));
    const after = await load(shiftDateKey(SPIKE, 1));

    expect(readLocalDailyStats).toHaveBeenCalledTimes(1);
    expect(spike).toEqual(expected(SPIKE));
    expect(spike.map((n) => n.kind)).toEqual(["extremeHigh"]);
    expect(before).toEqual(expected(shiftDateKey(SPIKE, -1)));
    expect(after).toEqual(expected(shiftDateKey(SPIKE, 1)));
  });

  it("never reads a type the modules switch off", async () => {
    await load(SPIKE);
    const [args] = readLocalDailyStats.mock.calls[0] as [
      { types: MeasurementType[] },
    ];
    expect(args.types).not.toContain("BLOOD_GLUCOSE");
    expect(args.types).toContain("BLOOD_PRESSURE_SYS");
  });

  it("reads live from a lookback floor inside the window", async () => {
    const floor = new Date(Date.now() - 60 * 86_400_000);
    await load(SPIKE, { floor });
    await load(SPIKE, { floor });

    expect(readLocalDailyStats).toHaveBeenCalledTimes(2);
    const [args] = readLocalDailyStats.mock.calls[0] as [{ from: Date }];
    expect(args.from).toEqual(floor);
  });
});
