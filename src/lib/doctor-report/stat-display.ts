/**
 * How a measurement statistic reads in the clinician-facing artefacts: the
 * PDF report and the shared clinician view.
 *
 * Both describe the same record to the same reader, so they take the unit and
 * the displayed number from here and nowhere else. Before this module the PDF
 * carried its own unit map and the clinician view printed bare numbers, so a
 * doctor opening a share link read "latest 5.8 (avg 6.1, range 4.9–7.4)" with
 * no unit at all, and for an account on mmol/L the glucose rows of the PDF's
 * measurement table still printed raw mg/dL beside a mmol/L glucose panel.
 *
 * The policy, which `display-transform.ts` states for the metric/imperial
 * preference: a document handed to a clinician stays SI for mass, length and
 * temperature regardless of the owner's imperial preference. Glucose is the
 * exception, because mmol/L versus mg/dL is not an imperial question — it is
 * the clinical convention of the country the record lives in — so glucose
 * follows the owner's `glucoseUnit` here as it does everywhere a person reads
 * it.
 */
import { convertGlucose, type GlucoseUnit } from "@/lib/glucose";
import { recordedPrecision } from "@/lib/format/recorded-number";
import { getReadingTransform } from "@/lib/measurements/display-transform";
import { getUnitForType } from "@/lib/validations/measurement";

/**
 * Report-specific unit symbols, where the report's own reading differs from
 * the validation layer's canonical unit. `null` marks a unit that has to be
 * translated (steps). Everything absent falls back to `getUnitForType`.
 */
export const DOCTOR_REPORT_TYPE_UNIT_KEYS: Record<string, string | null> = {
  WEIGHT: "kg",
  BLOOD_PRESSURE_SYS: "mmHg",
  BLOOD_PRESSURE_DIA: "mmHg",
  PULSE: "bpm",
  BODY_FAT: "%",
  SLEEP_DURATION: "h",
  ACTIVITY_STEPS: null, // translated unit
  TOTAL_BODY_WATER: "kg",
  BONE_MASS: "kg",
  OXYGEN_SATURATION: "%",
};

/**
 * The unit symbol a report statistic of `type` is printed with.
 *
 * `translate` resolves the one translated unit (steps). A type with no
 * recorded unit prints none — an absent unit is absent, not a guessed symbol.
 */
export function reportStatUnit(
  type: string,
  glucoseUnit: GlucoseUnit,
  translate: (key: string) => string,
): string {
  if (type === "BLOOD_GLUCOSE") return glucoseUnit;
  const staticUnit = DOCTOR_REPORT_TYPE_UNIT_KEYS[type];
  if (staticUnit === null && type === "ACTIVITY_STEPS") {
    return translate("doctorReport.unitSteps");
  }
  if (staticUnit !== undefined && staticUnit !== null) return staticUnit;
  const canonical = getUnitForType(type);
  return canonical === "unknown" ? "" : canonical;
}

/**
 * The number a report statistic of `type` is printed as, in the unit
 * {@link reportStatUnit} names.
 *
 * SLEEP_DURATION statistics are per-night asleep totals in minutes (the data
 * layer reconstructs them for exactly this row) while the unit is hours, so
 * they are divided — the same hours value the FHIR sleep Observation emits.
 * Glucose is stored in mg/dL and converted to the owner's unit.
 */
export function reportStatValue(
  type: string,
  value: number,
  glucoseUnit: GlucoseUnit,
): number {
  if (type === "SLEEP_DURATION") return value / 60;
  if (type === "BLOOD_GLUCOSE") return convertGlucose(value, glucoseUnit);
  return value;
}

/** Significant digits a statistic keeps before it is cut to decimals. */
const STAT_SIGNIFICANT_DIGITS = 3;

/** Decimals a statistic row never goes below, and never above. */
const STAT_MIN_FRACTION_DIGITS = 1;
const STAT_MAX_FRACTION_DIGITS = 3;

/**
 * Decimals for one statistic row of `type` (latest, average and range alike,
 * so a row reads in one precision), for the number {@link reportStatValue}
 * returns.
 *
 * A fixed single decimal printed a waist-to-height ratio of 0.52 as "0.5" and
 * a temperature deviation of 0.25 as "0.3": a measurement below or near 1
 * lost the digits that carry it. Each reading now keeps up to
 * {@link STAT_SIGNIFICANT_DIGITS} significant digits, but never more decimals
 * than it was recorded with, so a weight of 79.5 stays "79.5" and a device
 * figure of 45.123456 ms reads "45.1" rather than six decimals of sensor
 * noise. Glucose follows its unit's own precision (whole mg/dL, one decimal
 * mmol/L) and sleep, a quotient of minutes, keeps one decimal of hours.
 */
export function reportStatFractionDigits(
  type: string,
  stat: { latest: number; min: number; max: number },
  glucoseUnit: GlucoseUnit,
): number {
  if (type === "BLOOD_GLUCOSE") {
    // The report stays SI for everything but glucose, so only its unit counts.
    return getReadingTransform(type, { system: "metric", glucoseUnit })
      .decimals;
  }
  if (type === "SLEEP_DURATION") return 1;
  const needed = [stat.latest, stat.min, stat.max].map((raw) => {
    const value = reportStatValue(type, raw, glucoseUnit);
    if (value === 0 || !Number.isFinite(value)) return 0;
    const recorded = recordedPrecision(value).fractionDigits;
    const magnitude = Math.floor(Math.log10(Math.abs(value)));
    const significant = Math.max(0, STAT_SIGNIFICANT_DIGITS - 1 - magnitude);
    return Math.min(recorded, significant);
  });
  return Math.min(
    STAT_MAX_FRACTION_DIGITS,
    Math.max(STAT_MIN_FRACTION_DIGITS, ...needed),
  );
}
