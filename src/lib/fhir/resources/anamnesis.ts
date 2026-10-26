import { getServerTranslator } from "@/lib/i18n/server-translator";
import type { FhirBuildOptions } from "./common";
import type { DoctorReportData } from "@/lib/doctor-report-data";
import { LOINC_SYSTEM } from "@/lib/fhir/loinc-map";
import {
  SNOMED_SYSTEM,
  categoryConcept,
  patientRef,
} from "@/lib/fhir/resources/common";
import type { FhirCodeableConcept, FhirObservation } from "@/lib/fhir/types";
import type { HealthProfileFactKind } from "@/lib/validations/health-profile-facts";

const DATA_ABSENT_REASON_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/data-absent-reason";

interface AnamnesisFactDefinition {
  labelKey: string;
  code: string;
  display: string;
  valueDisplay: Readonly<Record<string, string>>;
  valueCoding?: Readonly<Record<string, FhirCodeableConcept>>;
}

/**
 * The source values are deliberately broader than several published value
 * sets. Only values with an exact SNOMED CT match receive a value coding; the
 * remaining value stays as `CodeableConcept.text` rather than asserting a more
 * specific clinical meaning than the user recorded.
 */
const FACT_DEFINITIONS: Readonly<
  Record<HealthProfileFactKind, AnamnesisFactDefinition>
> = {
  SMOKING_STATUS: {
    labelKey: "doctorReport.anamnesisSmoking",
    code: "72166-2",
    display: "Tobacco smoking status",
    valueDisplay: {
      NEVER: "Never smoker",
      FORMER: "Former smoker",
      CURRENT: "Current smoker",
    },
    valueCoding: {
      NEVER: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: "266919005",
            display: "Never smoked tobacco",
          },
        ],
      },
      FORMER: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: "8517006",
            display: "Ex-smoker",
          },
        ],
      },
      CURRENT: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: "77176002",
            display: "Smoker",
          },
        ],
      },
    },
  },
  ALCOHOL_PATTERN: {
    labelKey: "doctorReport.anamnesisAlcohol",
    code: "11331-6",
    display: "History of alcohol use",
    valueDisplay: {
      NONE: "None",
      OCCASIONAL: "Occasional",
      WEEKLY: "Weekly",
      MOST_DAYS: "Most days",
    },
  },
  SHIFT_SCHEDULE: {
    labelKey: "doctorReport.anamnesisShiftSchedule",
    code: "74159-5",
    display: "Work schedule NIOSH",
    valueDisplay: {
      NONE: "No shift work",
      FIXED_SHIFT: "Fixed shift",
      ROTATING: "Rotating shifts",
    },
  },
};

function absentReason(
  unreadable: boolean,
  options: FhirBuildOptions,
): FhirCodeableConcept {
  const t = options.locale === "zh-CN" ? getServerTranslator("zh-CN").t : null;
  return {
    coding: [
      {
        system: DATA_ABSENT_REASON_SYSTEM,
        code: unreadable ? "error" : "unknown",
        display: unreadable ? "Error" : "Unknown",
      },
    ],
    text: t
      ? t(
          unreadable
            ? "doctorReport.anamnesisUnreadable"
            : "doctorReport.anamnesisNotRecorded",
        )
      : unreadable
        ? "Recorded value is unreadable"
        : "Not recorded",
  };
}

/**
 * Emit all three facts whenever ANAMNESIS was selected. A missing or unreadable
 * value still produces its Observation with a distinct data-absent reason, so
 * a recipient can distinguish it from a leaf the user did not select.
 */
export function anamnesisObservationsFromReportData(
  data: DoctorReportData,
  options: FhirBuildOptions = {},
): FhirObservation[] {
  const t = options.locale === "zh-CN" ? getServerTranslator("zh-CN").t : null;
  const anamnesis = data.anamnesis;
  if (!anamnesis) return [];

  const values: Record<HealthProfileFactKind, string | null> = {
    SMOKING_STATUS: anamnesis.smokingStatus,
    ALCOHOL_PATTERN: anamnesis.alcoholPattern,
    SHIFT_SCHEDULE: anamnesis.shiftSchedule,
  };
  const kinds: readonly HealthProfileFactKind[] = [
    "SMOKING_STATUS",
    "ALCOHOL_PATTERN",
    "SHIFT_SCHEDULE",
  ];

  const facts = kinds.map((kind, index): FhirObservation => {
    const definition = FACT_DEFINITIONS[kind];
    const value = values[kind];
    const unreadable = anamnesis.unreadableFacts.includes(kind);
    const valueConcept =
      value && !unreadable
        ? {
            ...(definition.valueCoding?.[value] ?? {}),
            text:
              t && definition.valueDisplay[value]
                ? t(`records.profileFacts.values.${kind}.${value}`)
                : (definition.valueDisplay[value] ?? value),
          }
        : undefined;

    return {
      resourceType: "Observation",
      id: `obs-anamnesis-${index + 1}`,
      status: "final",
      category: [categoryConcept("social-history")],
      code: {
        coding: [
          {
            system: LOINC_SYSTEM,
            code: definition.code,
            display: definition.display,
          },
        ],
        text: t ? t(definition.labelKey) : definition.display,
      },
      subject: patientRef,
      ...(valueConcept
        ? { valueCodeableConcept: valueConcept }
        : { dataAbsentReason: absentReason(unreadable, options) }),
      ...(unreadable
        ? {
            note: [
              {
                text: t
                  ? t("doctorReport.anamnesisUnreadable")
                  : "The recorded value could not be read.",
              },
            ],
          }
        : {}),
    };
  });
  return [...facts, ...lifeObservationsFromReportData(data, options)];
}

/** Raw narrative text; the document builder performs XHTML escaping once. */
export function anamnesisNarrativeFromReportData(
  data: DoctorReportData,
  options: FhirBuildOptions = {},
): string | null {
  const t = options.locale === "zh-CN" ? getServerTranslator("zh-CN").t : null;
  const anamnesis = data.anamnesis;
  if (!anamnesis) return null;
  const factText = (
    kind: HealthProfileFactKind,
    value: string | null,
  ): string => {
    if (anamnesis.unreadableFacts.includes(kind))
      return t ? t("doctorReport.anamnesisUnreadable") : "unreadable";
    if (!value)
      return t ? t("doctorReport.anamnesisNotRecorded") : "not recorded";
    return t && FACT_DEFINITIONS[kind].valueDisplay[value]
      ? t(`records.profileFacts.values.${kind}.${value}`)
      : (FACT_DEFINITIONS[kind].valueDisplay[value] ?? value);
  };
  const conditions = anamnesis.conditionsUnreadable
    ? "unreadable"
    : (anamnesis.conditions ?? "not recorded");

  if (t)
    return [
      `${t("doctorReport.anamnesisConditions")}：${anamnesis.conditionsUnreadable ? t("doctorReport.anamnesisUnreadable") : (anamnesis.conditions ?? t("doctorReport.anamnesisNotRecorded"))}。`,
      `${t("doctorReport.anamnesisSmoking")}：${factText("SMOKING_STATUS", anamnesis.smokingStatus)}。`,
      `${t("doctorReport.anamnesisAlcohol")}：${factText("ALCOHOL_PATTERN", anamnesis.alcoholPattern)}。`,
      `${t("doctorReport.anamnesisShiftSchedule")}：${factText("SHIFT_SCHEDULE", anamnesis.shiftSchedule)}。`,
      ...(anamnesis.life?.packYears != null
        ? [`${t("doctorReport.lifePackYears")}：${anamnesis.life.packYears}。`]
        : []),
      ...(anamnesis.life?.auditC
        ? [
            t("doctorReport.lifeAuditCScore", {
              score: anamnesis.life.auditC.totalScore,
              date: anamnesis.life.auditC.takenAt.slice(0, 10),
            }),
          ]
        : []),
    ].join(" ");
  return [
    `Conditions: ${conditions}.`,
    `Smoking status: ${factText("SMOKING_STATUS", anamnesis.smokingStatus)}.`,
    `Alcohol pattern: ${factText("ALCOHOL_PATTERN", anamnesis.alcoholPattern)}.`,
    `Shift schedule: ${factText("SHIFT_SCHEDULE", anamnesis.shiftSchedule)}.`,
    ...(anamnesis.life?.packYears != null
      ? [`Pack-years: ${anamnesis.life.packYears}.`]
      : []),
    ...(anamnesis.life?.auditC
      ? [
          `AUDIT-C (screening): ${anamnesis.life.auditC.totalScore} of 12 on ${anamnesis.life.auditC.takenAt.slice(0, 10)}.`,
        ]
      : []),
  ].join(" ");
}

/**
 * v1.43 (#614) — the clinical part of the life circumstances: AUDIT-C as a
 * screening score (LOINC 75626-2), pack-years (SNOMED CT 401201003), and the
 * self-reported activity and work context as text observations. Only present
 * values emit; diet and goals never do (coach-only by design).
 */
function lifeObservationsFromReportData(
  data: DoctorReportData,
  options: FhirBuildOptions = {},
): FhirObservation[] {
  const t = options.locale === "zh-CN" ? getServerTranslator("zh-CN").t : null;
  const life = data.anamnesis?.life;
  if (!life) return [];
  const out: FhirObservation[] = [];
  const base = (id: string, category: string) => ({
    resourceType: "Observation" as const,
    id,
    status: "final" as const,
    category: [categoryConcept(category)],
    subject: patientRef,
  });

  if (life.auditC) {
    const a = life.auditC;
    const verdict =
      a.aboveCutoff === null || a.cutoffValue === null
        ? "No sex-specific cut-off applied (no binary sex in the profile)."
        : `${a.aboveCutoff ? "At or above" : "Below"} the screening cut-off of ${a.cutoffValue} (${a.cutoffSourceLabel ?? "source not named"}).`;
    out.push({
      ...base("obs-life-audit-c", "survey"),
      code: {
        coding: [
          {
            system: LOINC_SYSTEM,
            code: "75626-2",
            display: "Total score [AUDIT-C]",
          },
        ],
        text: t ? t("doctorReport.lifeAuditC") : "AUDIT-C total score",
      },
      effectiveDateTime: a.takenAt,
      valueInteger: a.totalScore,
      note: [
        {
          text: t
            ? t("fhir.screeningNotDiagnosis") +
              (a.aboveCutoff === null || a.cutoffValue === null
                ? t("fhir.noSexCutoff")
                : t(
                    a.aboveCutoff
                      ? "doctorReport.lifeAuditCAbove"
                      : "doctorReport.lifeAuditCBelow",
                    {
                      cutoff: a.cutoffValue,
                      source: a.cutoffSourceLabel ?? t("fhir.sourceUnnamed"),
                    },
                  ))
            : `Screening result, not a diagnosis. ${verdict}`,
        },
      ],
    });
  }

  if (life.packYears !== null) {
    out.push({
      ...base("obs-life-pack-years", "social-history"),
      code: {
        coding: [
          {
            system: SNOMED_SYSTEM,
            code: "401201003",
            display: "Cigarette pack-years",
          },
        ],
        text: t ? t("doctorReport.lifePackYears") : "Cigarette pack-years",
      },
      valueQuantity: { value: life.packYears, unit: "pack-years" },
      note: [
        {
          text: t
            ? t("fhir.packYearsSource")
            : "Computed from self-reported cigarettes per day and years smoked.",
        },
      ],
    });
  }

  if (
    life.activityMinutesPerWeek !== null ||
    life.sittingHoursWorkday !== null
  ) {
    const parts: string[] = [];
    if (life.activityMinutesPerWeek !== null) {
      parts.push(
        t
          ? t("fhir.activityValue", { minutes: life.activityMinutesPerWeek })
          : `${life.activityMinutesPerWeek} minutes of moderate to strenuous activity per week (Exercise Vital Sign)`,
      );
    }
    if (life.sittingHoursWorkday !== null) {
      parts.push(
        t
          ? t("fhir.sittingValue", { hours: life.sittingHoursWorkday })
          : `${life.sittingHoursWorkday} hours sitting on a workday`,
      );
    }
    out.push({
      ...base("obs-life-activity", "social-history"),
      code: {
        text: t ? t("fhir.activityLabel") : "Self-reported physical activity",
      },
      valueString: `${parts.join("; ")}.`,
    });
  }

  const work = life.work;
  if (work) {
    const parts = [
      work.situation
        ? t
          ? t("fhir.workSituation", {
              value: t(`records.life.values.situation.${work.situation}`),
            })
          : `situation: ${work.situation.replace(/_/g, " ")}`
        : null,
      work.physicalNature
        ? t
          ? t("fhir.workNature", {
              value: t(
                `records.life.values.physicalNature.${work.physicalNature}`,
              ),
            })
          : `physical nature: ${work.physicalNature.replace(/_/g, " ")}`
        : null,
      work.nightWork === null
        ? null
        : t
          ? t("fhir.nightWork", {
              value: t(work.nightWork ? "records.life.yes" : "records.life.no"),
            })
          : `night work: ${work.nightWork ? "yes" : "no"}`,
      work.exposures.length > 0
        ? t
          ? t("fhir.exposures", {
              value: work.exposures
                .map((e) => t(`records.life.values.exposures.${e}`))
                .join("、"),
            })
          : `exposures: ${work.exposures.map((e) => e.replace(/_/g, " ")).join(", ")}`
        : null,
    ].filter((part): part is string => part !== null);
    if (parts.length > 0) {
      out.push({
        ...base("obs-life-work", "social-history"),
        code: {
          coding: [
            {
              system: LOINC_SYSTEM,
              code: "11341-5",
              display: "History of Occupation",
            },
          ],
          text: t ? t("fhir.workLabel") : "Self-reported work context",
        },
        valueString: `${parts.join("; ")}.`,
      });
    }
  }
  return out;
}
