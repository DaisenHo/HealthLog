/**
 * The blood-pressure series: systolic points paired with the diastolic of
 * the same source within five minutes, from the ladder's one source per day.
 */
import { prisma } from "@/lib/db";
import { VALUE_RANGES } from "@/lib/validations/measurement";
import { loadUserSourcePriority } from "@/lib/rollups/measurement-read";
import { buildSourceRankCase } from "@/lib/analytics/source-rank-sql";

import type { SeriesRead } from "./kinds";

export async function readBloodPressureSeries(
  userId: string,
  since: Date,
): Promise<SeriesRead> {
  // Exclude non-physiological rows (systolic < 40 / diastolic < 20) from the
  // series AND the implicit "latest" (the last point). BP is two rows paired
  // client-side, so a corrupt row that slipped in before the input floor was
  // enforced — a seed-era systolic-0, iOS #33 — must never surface as the
  // latest reading. Floors mirror VALUE_RANGES (the input validator's min);
  // this is a read-side selection guard, not a tightening of the write floor.
  //
  // The ladder picks ONE source per day for the reading, not one per type:
  // the source is chosen from the day's systolic rows that pass the floor,
  // and both halves are read from it. Two per-type picks diverge whenever a
  // source holds only half of a reading on a day (a deleted diastolic, a
  // sub-floor systolic, an orphaned sample), and the pairing below then
  // joined one source's systolic to another source's diastolic. Picking on
  // floor-passing systolic rows also keeps a corrupt row from claiming a day
  // it then contributes nothing to. The day is the UTC day, as in every
  // other ladder read (`canonicalMeasurementsCte`), and the pick looks at
  // the whole edge day, not only the slice after `since`.
  //
  // `rank` is the closed-enum whitelist splice from `buildSourceRankCase`;
  // every request value is a positional parameter.
  const rank = buildSourceRankCase(
    await loadUserSourcePriority(userId),
    '"type"',
    '"source"',
  );
  const bpRows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      type: "BLOOD_PRESSURE_SYS" | "BLOOD_PRESSURE_DIA";
      source: string;
      value: number;
      measured_at: Date;
    }>
  >(
    `
    SELECT m."id", m."type"::text AS type, m."source"::text AS source,
           m."value", m."measured_at"
    FROM measurements m
    JOIN (
      SELECT DISTINCT ON (date_trunc('day', "measured_at"))
        date_trunc('day', "measured_at") AS d,
        "source"                         AS canon
      FROM measurements
      WHERE "user_id" = $1
        AND "type" = 'BLOOD_PRESSURE_SYS'::"measurement_type"
        AND "deleted_at" IS NULL
        AND "value" >= $3
        AND "measured_at" >= date_trunc('day', $2::timestamptz AT TIME ZONE 'UTC')
      ORDER BY date_trunc('day', "measured_at"), (${rank}), "source"::text
    ) c
      ON c.d = date_trunc('day', m."measured_at")
      AND c.canon = m."source"
    WHERE m."user_id" = $1
      AND m."deleted_at" IS NULL
      AND m."measured_at" >= $2
      AND (
        (m."type" = 'BLOOD_PRESSURE_SYS'::"measurement_type" AND m."value" >= $3)
        OR (m."type" = 'BLOOD_PRESSURE_DIA'::"measurement_type" AND m."value" >= $4)
      )
    ORDER BY m."measured_at" ASC, m."id" ASC
  `,
    userId,
    since,
    VALUE_RANGES.BLOOD_PRESSURE_SYS.min,
    VALUE_RANGES.BLOOD_PRESSURE_DIA.min,
  );
  const sys = bpRows.filter((r) => r.type === "BLOOD_PRESSURE_SYS");
  // Diastolic rows per source: a pair is only ever made inside one source,
  // which also holds across midnight, where the two days may have picked
  // different sources.
  const diaBySource = new Map<string, typeof bpRows>();
  for (const r of bpRows) {
    if (r.type !== "BLOOD_PRESSURE_DIA") continue;
    const list = diaBySource.get(r.source);
    if (list) list.push(r);
    else diaBySource.set(r.source, [r]);
  }

  // Pair by closest timestamp within ±5 minutes. Both reads arrive
  // sorted ascending, so the nearest-diastolic index is non-decreasing
  // across the systolic walk — a two-pointer merge (one pointer per
  // source) finds each pair in O(sys + dia) instead of the previous full
  // diastolic rescan per systolic row (O(sys × dia) — quadratic on dense
  // imports). Ties keep the earlier diastolic row, matching the old
  // scan's strict-`<` keep.
  const PAIR_WINDOW_MS = 5 * 60_000;
  const diaIdx = new Map<string, number>();
  const points = sys.map((s) => {
    const sysMs = s.measured_at.getTime();
    const dia = diaBySource.get(s.source) ?? [];
    let idx = diaIdx.get(s.source) ?? 0;
    while (
      idx + 1 < dia.length &&
      Math.abs(dia[idx + 1].measured_at.getTime() - sysMs) <
        Math.abs(dia[idx].measured_at.getTime() - sysMs)
    ) {
      idx += 1;
    }
    diaIdx.set(s.source, idx);
    const best = dia[idx];
    const paired =
      best !== undefined &&
      Math.abs(best.measured_at.getTime() - sysMs) <= PAIR_WINDOW_MS;
    return {
      id: s.id,
      at: s.measured_at.toISOString(),
      value: s.value,
      secondary: paired ? best.value : null,
    };
  });
  return { points };
}
