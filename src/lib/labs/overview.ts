/**
 * Per-marker overview of an account's lab history (`GET /api/labs/overview`).
 *
 * The Labs list shows one row per biomarker: its newest reading, how many
 * readings it has, and a small trend. It used to build that by fetching the
 * newest 500 raw rows and grouping them in the browser, so on a long history
 * every marker whose readings all lay beyond the 500th row vanished from the
 * list without a word. The grouping now happens here, over every live row, so
 * the answer does not depend on how many readings the other markers have.
 *
 * Grouping matches what the list always did: by the linked biomarker, or for a
 * legacy unlinked row case-insensitively by its analyte name.
 */
import { prisma } from "@/lib/db";
import { serialiseLabResult } from "@/lib/labs/serialise";

/**
 * Readings per marker that feed the trend sparkline, newest kept. The
 * sparkline is a 72px glyph; more points than this only overlap. The count
 * beside it is the full count, not this cap.
 */
export const LAB_OVERVIEW_TREND_POINTS = 50;

export interface LabOverviewMarker {
  /** `bm:<biomarkerId>`, or `analyte:<lower-cased name>` for a legacy row. */
  key: string;
  /** Every live reading of this marker. */
  count: number;
  /** Values of the newest readings, oldest first; null for a qualitative one. */
  trend: (number | null)[];
  /** The newest reading, as the list endpoint serialises a row. */
  latest: ReturnType<typeof serialiseLabResult>;
}

/**
 * One window-function read ranks every live row inside its marker, keeps the
 * newest `LAB_OVERVIEW_TREND_POINTS` of each, and a second read loads the
 * newest row per marker with its biomarker so it serialises exactly like a
 * list row. Markers come back newest reading first.
 */
export async function loadLabOverview(
  userId: string,
): Promise<LabOverviewMarker[]> {
  // Parameter-bound throughout. `id` breaks a `taken_at` tie the same way the
  // list endpoint's order does, so "newest" means the same row on both.
  const ranked = await prisma.$queryRaw<
    Array<{
      id: string;
      grp: string;
      value: number | null;
      rn: number;
      n: number;
    }>
  >`
    SELECT r."id", r."grp", r."value", r."rn"::int AS "rn", r."n"::int AS "n"
    FROM (
      SELECT g."id", g."grp", g."value",
        row_number() OVER (
          PARTITION BY g."grp" ORDER BY g."taken_at" DESC, g."id" DESC
        ) AS "rn",
        count(*) OVER (PARTITION BY g."grp") AS "n"
      FROM (
        SELECT l."id", l."value", l."taken_at",
          CASE
            WHEN l."biomarker_id" IS NOT NULL THEN 'bm:' || l."biomarker_id"
            ELSE 'analyte:' || lower(l."analyte")
          END AS "grp"
        FROM "lab_results" l
        WHERE l."user_id" = ${userId} AND l."deleted_at" IS NULL
      ) g
    ) r
    WHERE r."rn" <= ${LAB_OVERVIEW_TREND_POINTS}
  `;
  if (ranked.length === 0) return [];

  const groups = new Map<
    string,
    {
      latestId: string | null;
      count: number;
      points: Array<[number, number | null]>;
    }
  >();
  for (const row of ranked) {
    let group = groups.get(row.grp);
    if (!group) {
      group = { latestId: null, count: row.n, points: [] };
      groups.set(row.grp, group);
    }
    if (row.rn === 1) group.latestId = row.id;
    group.points.push([row.rn, row.value]);
  }

  const latestIds = [...groups.values()]
    .map((g) => g.latestId)
    .filter((id): id is string => id !== null);
  const rows = await prisma.labResult.findMany({
    where: { userId, id: { in: latestIds } },
    include: {
      biomarker: {
        select: {
          id: true,
          name: true,
          unit: true,
          lowerBound: true,
          upperBound: true,
          panel: true,
        },
      },
    },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));

  const markers: LabOverviewMarker[] = [];
  for (const [key, group] of groups) {
    const row = group.latestId ? byId.get(group.latestId) : undefined;
    // Deleted between the two reads: the marker is gone, not half-shown.
    if (!row) continue;
    markers.push({
      key,
      count: group.count,
      trend: group.points.sort((a, b) => b[0] - a[0]).map(([, value]) => value),
      latest: serialiseLabResult(row, row.biomarker ?? null),
    });
  }
  return markers.sort((a, b) => {
    const byTime = Date.parse(b.latest.takenAt) - Date.parse(a.latest.takenAt);
    if (byTime !== 0) return byTime;
    return a.latest.id < b.latest.id ? 1 : a.latest.id > b.latest.id ? -1 : 0;
  });
}
