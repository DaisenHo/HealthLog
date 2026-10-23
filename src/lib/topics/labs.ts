/**
 * The lab block of the metabolism topic: each marker's latest reading against
 * the reference window in force for it, and the marker's trend line.
 *
 * The window is the one the labs list judges the reading by
 * (`resolveEffectiveReferenceRange`: the range the report printed, else the
 * marker's catalog band); the trend is `computeLabTrend` over every numeric
 * reading of the marker against the marker's band, exactly as the marker page
 * computes it. A trend needs three readings spanning a year; below that it is
 * `insufficient` and the topic says what is missing.
 */
import { prisma } from "@/lib/db";
import { computeLabTrend, type LabTrend } from "@/lib/labs/lab-trend";
import {
  classifyReferenceRange,
  resolveEffectiveReferenceRange,
  type ReferenceRangeStatus,
} from "@/lib/labs/reference-range";
import { dateOnlyKey } from "@/lib/tz/date-only";

/** Markers the panel shows, the most recently measured first. */
export const LAB_PANEL_MAX_MARKERS = 24;

/** Readings the panel reads; far above any real history, the cap falls on the oldest. */
const LAB_READ_CAP = 4000;

export interface TopicLabMarker {
  biomarkerId: string;
  name: string;
  unit: string;
  latest: number;
  /** Calendar day of the newest reading. */
  takenOn: string;
  low: number | null;
  high: number | null;
  status: ReferenceRangeStatus;
  readings: number;
  trend: LabTrend;
}

export interface TopicLabPanel {
  markers: TopicLabMarker[];
  /** Markers whose latest reading sits inside its window. */
  inRange: number;
  /** Markers with a window to sit inside. */
  withRange: number;
  /** Calendar day of the newest reading across the panel. */
  latestOn: string | null;
}

interface MarkerRow {
  id: string;
  name: string;
  unit: string;
  lowerBound: number | null;
  upperBound: number | null;
}

interface ReadingRow {
  biomarkerId: string | null;
  value: number | null;
  takenAt: Date;
  sourceReferenceLow: number | null;
  sourceReferenceHigh: number | null;
  sourceReferenceText: string | null;
  sourceUnit: string | null;
}

/** Shape the panel from the rows. Pure; `readings` arrive newest first. */
export function shapeLabPanel(
  markers: readonly MarkerRow[],
  readings: readonly ReadingRow[],
  now: Date,
): TopicLabPanel | null {
  const byMarker = new Map<string, ReadingRow[]>();
  for (const row of readings) {
    if (row.biomarkerId === null || row.value === null) continue;
    const list = byMarker.get(row.biomarkerId) ?? [];
    list.push(row);
    byMarker.set(row.biomarkerId, list);
  }
  const shaped: TopicLabMarker[] = [];
  for (const marker of markers) {
    const rows = byMarker.get(marker.id);
    if (!rows || rows.length === 0) continue;
    const newest = rows.reduce((a, b) => (b.takenAt > a.takenAt ? b : a));
    const window = resolveEffectiveReferenceRange(
      marker.lowerBound,
      marker.upperBound,
      newest,
    );
    const latest = newest.value as number;
    shaped.push({
      biomarkerId: marker.id,
      name: marker.name,
      unit: marker.unit,
      latest,
      takenOn: dateOnlyKey(newest.takenAt),
      low: window.low,
      high: window.high,
      status: classifyReferenceRange(latest, window.low, window.high),
      readings: rows.length,
      trend: computeLabTrend(
        rows.map((r) => ({ takenAt: r.takenAt, value: r.value as number })),
        { low: marker.lowerBound, high: marker.upperBound },
        now,
      ),
    });
  }
  if (shaped.length === 0) return null;
  shaped.sort((a, b) =>
    a.takenOn === b.takenOn
      ? a.name.localeCompare(b.name)
      : a.takenOn < b.takenOn
        ? 1
        : -1,
  );
  const panel = shaped.slice(0, LAB_PANEL_MAX_MARKERS);
  const withWindow = panel.filter((m) => m.status !== "unknown");
  return {
    markers: panel,
    inRange: withWindow.filter((m) => m.status === "in-range").length,
    withRange: withWindow.length,
    latestOn: panel[0]?.takenOn ?? null,
  };
}

export async function readLabPanel(
  userId: string,
  now: Date,
): Promise<TopicLabPanel | null> {
  const [markers, readings] = await Promise.all([
    prisma.biomarker.findMany({
      where: { userId, hidden: false },
      select: {
        id: true,
        name: true,
        unit: true,
        lowerBound: true,
        upperBound: true,
      },
    }),
    prisma.labResult.findMany({
      where: {
        userId,
        deletedAt: null,
        value: { not: null },
        biomarkerId: { not: null },
      },
      orderBy: { takenAt: "desc" },
      take: LAB_READ_CAP,
      select: {
        biomarkerId: true,
        value: true,
        takenAt: true,
        sourceReferenceLow: true,
        sourceReferenceHigh: true,
        sourceReferenceText: true,
        sourceUnit: true,
      },
    }),
  ]);
  return shapeLabPanel(markers, readings, now);
}
