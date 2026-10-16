/**
 * The nutrient reads every surface shares: `GET /api/nutrients`,
 * `GET /api/nutrients/daily` and the MCP `get_nutrients` tool.
 *
 * A day can carry one row per source (migration 0249 put `source` in the
 * key, v1.43 added `SUPPLEMENT`), so every read sums a day across its rows
 * and, since v1.43, also keeps the split by source and judges the day
 * against the nutrient's upper intake level. The judgement is made here,
 * once, so no client and no prompt ever compares a number against a limit
 * of its own.
 */
import { prisma } from "@/lib/db";
import {
  NUTRIENT_CATALOG,
  NUTRIENT_CODES,
  isAboveUpperLimit,
  isNutrientCode,
  type NutrientCode,
  type NutrientUpperLimit,
} from "@/lib/nutrients/catalog";
import {
  NUTRIENT_SOURCE,
  isNutrientSource,
  type NutrientSource,
} from "@/lib/nutrients/sources";
import { shiftDateKey, userDayKey } from "@/lib/tz/format";

/** A day's amount split by source; a source with nothing is absent. */
export type NutrientAmountBySource = Partial<Record<NutrientSource, number>>;

interface StoredRow {
  nutrient: string;
  day: string;
  amount: number;
  unit: string;
  source: string;
}

interface DayFold {
  total: number;
  bySource: NutrientAmountBySource;
}

function addToDay(fold: DayFold, source: string, amount: number): void {
  fold.total += amount;
  // A source outside the closed set still counts toward the day's total; it
  // only cannot be named in the split.
  if (isNutrientSource(source)) {
    fold.bySource[source] = (fold.bySource[source] ?? 0) + amount;
  }
}

/** Whether one folded day is above the code's upper limit (null without one). */
function dayAboveLimit(code: NutrientCode, fold: DayFold): boolean | null {
  return isAboveUpperLimit(code, {
    total: fold.total,
    supplemental: fold.bySource[NUTRIENT_SOURCE.SUPPLEMENT] ?? 0,
  });
}

/** The window's first day key, anchored on the caller's local today. */
export function nutrientWindowStart(timezone: string, days: number): string {
  return shiftDateKey(userDayKey(new Date(), timezone), -(days - 1));
}

export interface NutrientOverviewRow {
  nutrient: NutrientCode;
  unit: string;
  latestDay: string;
  latestAmount: number;
  daysWithData: number;
  latestBySource: NutrientAmountBySource;
  upperLimit: NutrientUpperLimit | null;
  latestAboveUpperLimit: boolean | null;
}

/**
 * Per nutrient with data inside the window: the latest day, its total and its
 * split, the count of distinct days with data, and the upper-limit verdict for
 * the latest day. Catalog order; a stored code that fell out of the catalog is
 * dropped rather than mislabelled.
 */
export async function readNutrientOverview(
  userId: string,
  timezone: string,
  days: number,
): Promise<{ nutrients: NutrientOverviewRow[]; rowCount: number }> {
  const since = nutrientWindowStart(timezone, days);
  const rows: StoredRow[] = await prisma.nutrientIntakeDay.findMany({
    where: { userId, day: { gte: since } },
    orderBy: [{ nutrient: "asc" }, { day: "desc" }],
    select: {
      nutrient: true,
      unit: true,
      day: true,
      amount: true,
      source: true,
    },
  });

  const byCode = new Map<
    string,
    { unit: string; latestDay: string; latest: DayFold; daysSeen: Set<string> }
  >();
  for (const row of rows) {
    let summary = byCode.get(row.nutrient);
    if (!summary) {
      // Rows arrive day-DESC inside each nutrient: the first day seen is the
      // latest one.
      summary = {
        unit: row.unit,
        latestDay: row.day,
        latest: { total: 0, bySource: {} },
        daysSeen: new Set(),
      };
      byCode.set(row.nutrient, summary);
    }
    // A set of distinct day keys, so a day with several source rows counts
    // once.
    summary.daysSeen.add(row.day);
    if (row.day === summary.latestDay) {
      addToDay(summary.latest, row.source, row.amount);
    }
  }

  const nutrients = NUTRIENT_CODES.filter(
    (code) => isNutrientCode(code) && byCode.has(code),
  ).map((code) => {
    const summary = byCode.get(code)!;
    return {
      nutrient: code,
      unit: summary.unit,
      latestDay: summary.latestDay,
      latestAmount: summary.latest.total,
      daysWithData: summary.daysSeen.size,
      latestBySource: summary.latest.bySource,
      upperLimit: NUTRIENT_CATALOG[code].upperLimit,
      latestAboveUpperLimit: dayAboveLimit(code, summary.latest),
    };
  });

  return { nutrients, rowCount: rows.length };
}

export interface NutrientDailyEntry {
  day: string;
  amount: number;
  bySource: NutrientAmountBySource;
  aboveUpperLimit: boolean | null;
}

/**
 * One nutrient's dense day series over the window: one entry per calendar
 * day, 0 and an empty split on a day without data, each judged against the
 * upper limit.
 */
export async function readNutrientDaily(
  userId: string,
  timezone: string,
  nutrient: NutrientCode,
  days: number,
): Promise<{ days: NutrientDailyEntry[]; rowCount: number }> {
  const since = nutrientWindowStart(timezone, days);
  const rows = await prisma.nutrientIntakeDay.findMany({
    where: { userId, nutrient, day: { gte: since } },
    select: { day: true, amount: true, source: true },
  });

  const folds = new Map<string, DayFold>();
  for (const row of rows) {
    let fold = folds.get(row.day);
    if (!fold) {
      fold = { total: 0, bySource: {} };
      folds.set(row.day, fold);
    }
    addToDay(fold, row.source, row.amount);
  }

  const series: NutrientDailyEntry[] = [];
  for (let i = 0; i < days; i++) {
    const day = shiftDateKey(since, i);
    const fold = folds.get(day) ?? { total: 0, bySource: {} };
    series.push({
      day,
      amount: fold.total,
      bySource: fold.bySource,
      aboveUpperLimit: dayAboveLimit(nutrient, fold),
    });
  }
  return { days: series, rowCount: rows.length };
}
