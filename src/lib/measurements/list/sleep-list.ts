/**
 * The SLEEP_DURATION list: one row per night, or one night's stage segments.
 *
 * Sleep is stored one row per STAGE per night (minutes); a plain list would
 * leak every stage segment as its own "value". The list collapses the raw rows
 * into the canonical per-night shape used by the chart series and the
 * dashboard tile.
 *
 * Two modes:
 *  - `dayKey` set → drill-down: the night's stage SEGMENTS (the canonical
 *    source's per-stage spans), read exactly as the night view reads them.
 *  - no `dayKey` → one synthetic row per night, value = the day's TIME ASLEEP
 *    in minutes (the canonical unit): the main night plus that day's naps,
 *    `daySleepMinutes`, the same total the series and the sleep score read.
 *    The main night alone rides as `mainAsleepMinutes`, beside its stage
 *    breakdown, nap count and awakenings, so the UI can caption the night
 *    without a second fetch.
 *
 * The nights are paged in Postgres (`sleepNightPage`) and only the stage rows
 * of the page's nights are read. Every page night gets a row, so a page is as
 * long as its limit and `meta.total` counts exactly the rows a full walk sees.
 * A day whose only sleep is daytime naps has no main night: its row carries
 * the naps' minutes as its value and `mainAsleepMinutes: null`, as
 * `/api/sleep/night?date=` answers the same day with `main: null` and the
 * naps.
 */
import { annotate } from "@/lib/logging/context";
import { apiSuccess } from "@/lib/api-response";
import { getUnitForType } from "@/lib/validations/measurement";
import { loadUserSourcePriority } from "@/lib/rollups/measurement-read";
import { resolveStoredTimezone } from "@/lib/tz/resolver";
import {
  daySleepMinutes,
  pickMainNightAndNaps,
  reconstructSleepSessions,
  type SleepSession,
} from "@/lib/analytics/sleep-night";
import {
  readNightSessions,
  readNightSpanRows,
  sleepNightPage,
} from "./sleep-nights";

/**
 * A sleep page holds at most this many nights. The nights' stage rows are
 * read and reconstructed in the process, so the bound sits on the nights;
 * the applied value comes back as `meta.limit`, and `meta.total` still counts
 * every night, so a caller asking for more pages on rather than losing any.
 */
export const SLEEP_NIGHT_PAGE_MAX = 1000;

export async function sleepListResponse(
  user: { id: string; timezone?: string | null },
  opts: {
    from?: Date;
    to?: Date;
    limit: number;
    offset: number;
    sortDir: "asc" | "desc";
    dayKey?: string;
  },
) {
  const { from, to, offset, sortDir, dayKey } = opts;
  const limit = Math.min(opts.limit, SLEEP_NIGHT_PAGE_MAX);
  const [tz, priorityJson] = await Promise.all([
    resolveStoredTimezone(user.timezone),
    loadUserSourcePriority(user.id),
  ]);
  const dayUnit = getUnitForType("SLEEP_DURATION");

  if (dayKey) {
    const { sessions } = await readNightSessions(
      user.id,
      dayKey,
      tz,
      priorityJson,
      { from, to },
    );
    const { main, naps } = pickMainNightAndNaps(sessions);
    // One row per stage segment of the main night + each nap, so the
    // drill-down reveals exactly the rows that summed into the row.
    const measurements = [main, ...naps]
      .filter((s): s is SleepSession => s != null)
      .flatMap((s) => s.segments)
      .sort((a, b) =>
        sortDir === "asc"
          ? a.start.getTime() - b.start.getTime()
          : b.start.getTime() - a.start.getTime(),
      )
      .map((seg, i) => ({
        id: `sleep-seg:${dayKey}:${i}`,
        type: "SLEEP_DURATION",
        value: Math.round(seg.minutes),
        unit: dayUnit,
        source: main?.source ?? naps[0]?.source ?? "MANUAL",
        measuredAt: seg.end.toISOString(),
        sleepStage: seg.stage,
        notes: null,
      }));
    annotate({
      action: { name: "measurement.list" },
      meta: {
        total: measurements.length,
        type: "SLEEP_DURATION",
        dayKey,
        mode: "sleep-drill-down",
      },
    });
    return apiSuccess({
      measurements,
      meta: { total: measurements.length, limit, offset: 0, dayKey },
    });
  }

  const page = await sleepNightPage(user.id, tz, {
    from,
    to,
    sortDir,
    limit,
    offset,
  });
  const rows = await readNightSpanRows(user.id, page.nights, { from, to });
  const byDay = new Map<string, SleepSession[]>();
  for (const s of reconstructSleepSessions(rows, tz, priorityJson)) {
    const list = byDay.get(s.night) ?? [];
    list.push(s);
    byDay.set(s.night, list);
  }

  // Rows follow the page's night order from SQL.
  const measurements = page.nights.map(({ night, spanEnd }) => {
    const { main, naps } = pickMainNightAndNaps(byDay.get(night) ?? []);
    const lastNap = naps.at(-1);
    return {
      // Synthetic id mirrors the series route's `sleep:<night>` shape.
      id: `sleep:${night}`,
      type: "SLEEP_DURATION",
      value: Math.round(daySleepMinutes({ main, naps })),
      mainAsleepMinutes: main ? Math.round(main.asleepMinutes) : null,
      unit: dayUnit,
      source: main?.source ?? naps[0]?.source ?? "MANUAL",
      measuredAt: (main?.end ?? lastNap?.end ?? spanEnd).toISOString(),
      notes: null,
      dayKey: night,
      // Drives the drill-down chevron: the stage segments behind the row,
      // the main night's and the naps', exactly what the drill-down returns.
      sampleCount: [main, ...naps].reduce(
        (sum, s) => sum + (s?.segments.length ?? 0),
        0,
      ),
      sleepStages: (main?.stages ?? {}) as Record<string, number>,
      inBedMinutes: main?.inBedMinutes ?? null,
      awakeMinutes: main?.awakeMinutes ?? null,
      napCount: naps.length,
      napAsleepMinutes: naps.reduce((sum, n) => sum + n.asleepMinutes, 0),
      awakenings: main?.awakenings ?? 0,
    };
  });

  annotate({
    action: { name: "measurement.list" },
    meta: {
      total: page.total,
      type: "SLEEP_DURATION",
      mode: "sleep-per-night",
      nights: measurements.length,
      rowsScanned: rows.length,
    },
  });
  return apiSuccess({
    measurements,
    meta: { total: page.total, limit, offset, groupBy: "night" },
  });
}
