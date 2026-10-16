/**
 * v1.43 (#614) — the life-circumstance rows of the anamnesis section, one
 * builder for the PDF and the clinician share view so both print the same
 * lines. Self-reported values, labelled as such; AUDIT-C as a screening
 * result with its cut-off and source, never as a finding. Diet and goals are
 * not here on purpose (coach-only by design).
 *
 * Client-safe: pure, takes the translator and formatters it renders with.
 */
import type { LifeClinicalSummary } from "@/lib/profile/life-derived";

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

export function lifeReportRows(
  life: LifeClinicalSummary | undefined,
  t: Translate,
  fmtNum: (value: number) => string,
  fmtDate: (iso: string) => string,
): Array<[string, string]> {
  if (!life) return [];
  const absent = t("doctorReport.anamnesisNotRecorded");
  const rows: Array<[string, string]> = [];

  rows.push([
    t("doctorReport.lifePackYears"),
    life.packYears === null ? absent : fmtNum(life.packYears),
  ]);

  if (life.auditC) {
    const a = life.auditC;
    const score = t("doctorReport.lifeAuditCScore", {
      score: a.totalScore,
      date: fmtDate(a.takenAt),
    });
    const verdict =
      a.aboveCutoff === null || a.cutoffValue === null
        ? t("doctorReport.lifeAuditCNoCutoff")
        : t(
            a.aboveCutoff
              ? "doctorReport.lifeAuditCAbove"
              : "doctorReport.lifeAuditCBelow",
            { cutoff: a.cutoffValue, source: a.cutoffSourceLabel ?? "" },
          );
    rows.push([t("doctorReport.lifeAuditC"), `${score} ${verdict}`]);
  } else {
    rows.push([t("doctorReport.lifeAuditC"), absent]);
  }

  rows.push([
    t("doctorReport.lifeActivity"),
    life.activityMinutesPerWeek === null
      ? absent
      : t("doctorReport.lifeActivityValue", {
          minutes: fmtNum(life.activityMinutesPerWeek),
        }),
  ]);
  rows.push([
    t("doctorReport.lifeSitting"),
    life.sittingHoursWorkday === null
      ? absent
      : t("doctorReport.lifeSittingValue", {
          hours: fmtNum(life.sittingHoursWorkday),
        }),
  ]);

  const work = life.work;
  const workParts: string[] = [];
  if (work?.situation) {
    workParts.push(t(`records.life.values.situation.${work.situation}`));
  }
  if (work?.physicalNature) {
    workParts.push(
      t(`records.life.values.physicalNature.${work.physicalNature}`),
    );
  }
  if (work?.nightWork === true) workParts.push(t("doctorReport.lifeNightWork"));
  if (work && work.exposures.length > 0) {
    workParts.push(
      t("doctorReport.lifeExposures", {
        list: work.exposures
          .map((exposure) => t(`records.life.values.exposures.${exposure}`))
          .join(", "),
      }),
    );
  }
  rows.push([
    t("doctorReport.lifeWork"),
    workParts.length > 0 ? workParts.join(", ") : absent,
  ]);

  return rows;
}
