/**
 * The two leaves the v1.44 report added, on the clinician page: the per-sport
 * workout summary and the medication effect around each start. Content and
 * order follow the PDF blocks in `doctor-report-pdf/activity-effect-sections`,
 * and both read the same aggregated payload.
 *
 * A pure server component: no client hooks, no markdown — every value renders
 * as escaped React text.
 */
import type { MeasurementType } from "@/generated/prisma/client";
import type { DoctorReportData } from "@/lib/doctor-report-data";
import { reportStatUnit } from "@/lib/doctor-report/stat-display";
import { resolveGlucoseUnit } from "@/lib/glucose";
import { formatEstimate } from "@/lib/medications/efficacy/segmented-format";
import { reportMeasurementLabelKey } from "@/lib/report-selection/catalogue";
import { reportSportLabel } from "@/lib/doctor-report/sport-label";
import {
  LeafSection,
  StatRow,
  type LeafScope,
  type Translate,
} from "./report-sections";

const REASON_KEYS = {
  no_start: "doctorReport.medicationEffect.reasonNoStart",
  insufficient_before: "doctorReport.medicationEffect.reasonBefore",
  insufficient_after: "doctorReport.medicationEffect.reasonAfter",
  fit_failed: "doctorReport.medicationEffect.reasonFit",
} as const;

const CONFOUNDER_KEYS = {
  started: "medications.efficacy.segmented.confounderStarted",
  stopped: "medications.efficacy.segmented.confounderStopped",
  dose_change: "medications.efficacy.segmented.confounderDoseChange",
  paused: "medications.efficacy.segmented.confounderPaused",
  resumed: "medications.efficacy.segmented.confounderResumed",
} as const;

export function WorkoutsSection({
  t,
  report,
  scope,
  fmtDigits,
}: {
  t: Translate;
  report: DoctorReportData;
  scope: LeafScope;
  fmtDigits: (n: number, digits: number) => string;
}) {
  const w = report.workouts ?? null;
  return (
    <LeafSection
      t={t}
      scope={scope}
      leaves={["WORKOUTS"]}
      title={t("doctorReport.workouts.title")}
      empty={w === null || w.sessions === 0}
    >
      {w ? (
        <>
          <p className="text-muted-foreground mb-2 text-xs">
            {t("doctorReport.workouts.summary", {
              sessions: w.sessions,
              hours: fmtDigits(w.totalDurationSec / 3600, 1),
              perWeek: fmtDigits(w.sessionsPerWeek, 1),
              minutesPerWeek: fmtDigits(w.minutesPerWeek, 0),
            })}
          </p>
          {w.bySport.map((s) => (
            <StatRow
              key={s.sportType}
              label={`${reportSportLabel(t, s.sportType)} (${s.sessions})`}
              value={[
                `${fmtDigits(s.durationSec / 3600, 1)} h`,
                s.distanceM !== null
                  ? `${fmtDigits(s.distanceM / 1000, 1)} km`
                  : null,
                s.energyKcal !== null
                  ? `${fmtDigits(s.energyKcal, 0)} kcal`
                  : null,
                s.avgHeartRate !== null
                  ? `${fmtDigits(s.avgHeartRate, 0)} bpm`
                  : null,
              ]
                .filter(Boolean)
                .join(", ")}
            />
          ))}
          {w.sportCount > w.bySport.length ? (
            <p className="text-muted-foreground mt-2 text-xs">
              {t("doctorReport.workouts.moreSports", {
                count: w.sportCount - w.bySport.length,
              })}
            </p>
          ) : null}
        </>
      ) : null}
    </LeafSection>
  );
}

export function MedicationEffectSection({
  t,
  report,
  scope,
  fmtDigits,
  fmtDay,
}: {
  t: Translate;
  report: DoctorReportData;
  scope: LeafScope;
  fmtDigits: (n: number, digits: number) => string;
  /** A stated calendar day (YYYY-MM-DD) in the owner's date order. */
  fmtDay: (day: string) => string;
}) {
  // The block names medications: without the list leaf it shows nothing,
  // whatever the payload carries.
  const effects = scope.admits("MEDICATION_LIST")
    ? (report.medicationEffects ?? [])
    : [];
  const glucoseUnit = resolveGlucoseUnit(report.glucoseUnit ?? null);
  return (
    <LeafSection
      t={t}
      scope={scope}
      leaves={["MEDICATION_EFFECT"]}
      title={t("doctorReport.medicationEffect.title")}
      empty={effects.length === 0}
    >
      {effects.flatMap((med) =>
        med.targets.map((target) => {
          const e = target.effect;
          const label = `${med.medicationName}: ${t(
            reportMeasurementLabelKey(target.type as MeasurementType),
          )}`;
          const unit = reportStatUnit(target.type, glucoseUnit, t);
          if (!e.present || !e.levelChange || !e.slopeChangePerWeek) {
            return (
              <StatRow
                key={`${med.medicationName}:${target.type}`}
                label={label}
                value={t(REASON_KEYS[e.reason ?? "fit_failed"])}
              />
            );
          }
          const level = formatEstimate(e.levelChange, fmtDigits);
          const slope = formatEstimate(e.slopeChangePerWeek, fmtDigits);
          return (
            <div
              key={`${med.medicationName}:${target.type}`}
              className="border-border/40 border-b py-2 last:border-0"
            >
              <p className="text-foreground text-sm font-medium">{label}</p>
              <p className="text-foreground text-sm">
                {t("medications.efficacy.segmented.level", {
                  ...level,
                  unit,
                })}
              </p>
              <p className="text-foreground text-sm">
                {t("medications.efficacy.segmented.slope", {
                  ...slope,
                  unit,
                })}
              </p>
              {e.window ? (
                <p className="text-muted-foreground text-xs">
                  {t("doctorReport.medicationEffect.windowLine", {
                    from: fmtDay(e.window.from),
                    to: fmtDay(e.window.to),
                  })}
                </p>
              ) : null}
              <p className="text-muted-foreground text-xs">
                {t("doctorReport.medicationEffect.days", {
                  before: e.days.before,
                  after: e.days.after,
                  excluded:
                    e.days.excludedLowAdherence + e.days.excludedNotTaking,
                })}
              </p>
              {e.fit?.autocorrelationCaveat ? (
                <p className="text-muted-foreground text-xs">
                  {t("medications.efficacy.segmented.autocorrelation")}
                </p>
              ) : null}
              {e.confounders.map((c) => (
                <p
                  key={`${c.medicationName}:${c.event}:${c.date}`}
                  className="text-muted-foreground text-xs"
                >
                  {t(CONFOUNDER_KEYS[c.event], {
                    name: c.medicationName,
                    date: fmtDay(c.date),
                  })}
                </p>
              ))}
            </div>
          );
        }),
      )}
      {effects.length > 0 ? (
        <p className="text-muted-foreground mt-2 text-xs">
          {t("doctorReport.medicationEffect.method")}
        </p>
      ) : null}
    </LeafSection>
  );
}
