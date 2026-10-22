/**
 * The medication-effect block of the doctor report: for each listed
 * medication, the segmented-regression effect on its target metric(s) around
 * its start, from the same loader the efficacy tab reads.
 *
 * Bounded: at most {@link REPORT_EFFECT_MEDICATION_CAP} medications, each a
 * handful of reads (targets, intake events, confounders, one per-day SQL fold
 * per target), whatever the window length. Every read stops at the report's
 * end, so a report pinned in the past never uses later data.
 *
 * A target rides only when the gate admits its own measurement leaf: a
 * deselected blood-pressure series must not come back as a blood-pressure
 * effect. Lab targets are left out (too sparse for a daily series).
 */
import type { MeasurementType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { dayKeyOfDate } from "@/lib/medications/course-window";
import { resolveEffectiveTargets } from "@/lib/medications/efficacy/build-efficacy";
import {
  EFFECT_MEDICATION_INCLUDE,
  loadSegmentedEffects,
} from "@/lib/medications/efficacy/load-segmented-effects";
import type { DoctorReportMedicationEffect } from "@/lib/doctor-report-types";

/** Medications the block computes at most, in the report's list order. */
export const REPORT_EFFECT_MEDICATION_CAP = 8;

export async function loadReportMedicationEffects(params: {
  userId: string;
  medicationIds: readonly string[];
  admitsMeasurement: (type: MeasurementType) => boolean;
  timezone: string;
  end: Date;
}): Promise<DoctorReportMedicationEffect[] | null> {
  const { userId, medicationIds, admitsMeasurement, timezone, end } = params;
  if (medicationIds.length === 0) return null;
  const meds = await prisma.medication.findMany({
    where: { userId, id: { in: [...medicationIds] }, oneShot: false },
    include: EFFECT_MEDICATION_INCLUDE,
  });
  const order = new Map(medicationIds.map((id, i) => [id, i]));
  meds.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  const out: DoctorReportMedicationEffect[] = [];
  for (const med of meds) {
    if (out.length >= REPORT_EFFECT_MEDICATION_CAP) break;
    const resolved = await resolveEffectiveTargets({
      id: med.id,
      name: med.name,
      treatmentClass: med.treatmentClass,
      atcCode: med.atcCode ?? null,
    });
    const metricTargets = resolved.targets
      .flatMap((t) => (t.kind === "metric" ? [t.measurementType] : []))
      .filter((type) => admitsMeasurement(type));
    if (metricTargets.length === 0) continue;
    const effects = await loadSegmentedEffects({
      userId,
      med,
      targets: metricTargets,
      timezone,
      now: end,
    });
    out.push({
      medicationName: med.name,
      startsOn: med.startsOn ? dayKeyOfDate(med.startsOn) : null,
      targets: metricTargets.flatMap((type) => {
        const effect = effects.get(type);
        return effect ? [{ type, effect }] : [];
      }),
    });
  }
  return out.length > 0 ? out : null;
}
