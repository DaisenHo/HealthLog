/**
 * v1.43 (#614) — the pure half of the life circumstances: which kinds belong
 * to which section, and every number the read route derives from the answers
 * (pack-years, activity minutes, free weekdays, the screening hints). The
 * server resolves these once; the web and the app render them as delivered.
 *
 * Nothing here is ever inferred from anything but the person's own answers
 * and the two profile columns it needs (birth date and sex): no smoking status
 * from mood tags, no activity from steps. A missing input is an honest
 * "missing", never a zero.
 *
 * Client-safe: no database, no crypto.
 */
import { countryLabel } from "@/lib/profile/country-label";
import type {
  LifeAiSection,
  LifeFactKind,
  LifeSectionKey,
  TobaccoDetailValue,
  WorkContextValue,
} from "@/lib/validations/life-circumstances";

/** The kinds a section shows, in display order. Alcohol is AUDIT-C, not a fact. */
export const LIFE_SECTIONS: ReadonlyArray<{
  key: LifeSectionKey;
  aiSection: Exclude<LifeAiSection, "SHIFT_SCHEDULE">;
  kinds: ReadonlyArray<"SMOKING_STATUS" | "SHIFT_SCHEDULE" | LifeFactKind>;
}> = [
  {
    key: "tobacco",
    aiSection: "SMOKING_STATUS",
    kinds: ["SMOKING_STATUS", "TOBACCO_DETAIL"],
  },
  { key: "alcohol", aiSection: "ALCOHOL_PATTERN", kinds: [] },
  { key: "activity", aiSection: "ACTIVITY", kinds: ["ACTIVITY_HABIT"] },
  {
    key: "work",
    aiSection: "WORK",
    kinds: ["SHIFT_SCHEDULE", "WORK_CONTEXT", "FREE_WEEKDAYS"],
  },
  { key: "habits", aiSection: "HABITS", kinds: ["HABITS"] },
  { key: "goals", aiSection: "GOALS", kinds: ["HEALTH_GOALS"] },
];

/**
 * The AI section each life kind is released under. A kind reaches a prompt
 * only when this section is in the profile's inclusion list; otherwise it is
 * never even decrypted for one.
 */
export const LIFE_KIND_AI_SECTION: Readonly<
  Record<LifeFactKind, LifeAiSection>
> = {
  TOBACCO_DETAIL: "SMOKING_STATUS",
  ACTIVITY_HABIT: "ACTIVITY",
  WORK_CONTEXT: "WORK",
  FREE_WEEKDAYS: "WORK",
  HABITS: "HABITS",
  HEALTH_GOALS: "GOALS",
};

/** A section asks "still true?" once its newest answer or confirmation is this old. */
export const REVIEW_AFTER_DAYS = 365;
const MS_PER_DAY = 86_400_000;

/** UTC midnight of a `YYYY-MM-DD` calendar day. */
export function dayStartUtc(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/** Whether an instant is at least `REVIEW_AFTER_DAYS` before `now`. */
export function isReviewDue(at: Date | null, now: Date): boolean {
  return (
    at !== null &&
    now.getTime() - at.getTime() >= REVIEW_AFTER_DAYS * MS_PER_DAY
  );
}

// ── Pack-years ───────────────────────────────────────────────────────────────

export interface PackYears {
  value: number | null;
  status: "computed" | "not_applicable" | "missing_inputs";
}

/**
 * Cigarettes per day / 20 × years smoked, to one decimal. Years run from the
 * start year to the quit year for a former smoker, to the current year
 * otherwise. Only with both inputs; never estimated.
 */
export function computePackYears(
  smokingStatus: string | null,
  detail: TobaccoDetailValue | null,
  now: Date,
): PackYears {
  if (smokingStatus === "NEVER")
    return { value: null, status: "not_applicable" };
  if (
    detail &&
    detail.products.length > 0 &&
    !detail.products.includes("cigarettes")
  ) {
    return { value: null, status: "not_applicable" };
  }
  if (
    !detail ||
    detail.cigarettesPerDay === null ||
    detail.startYear === null
  ) {
    return { value: null, status: "missing_inputs" };
  }
  const quitYear = detail.quitMonth
    ? Number(detail.quitMonth.slice(0, 4))
    : null;
  if (smokingStatus === "FORMER" && quitYear === null) {
    return { value: null, status: "missing_inputs" };
  }
  const endYear =
    smokingStatus === "CURRENT" || quitYear === null
      ? now.getUTCFullYear()
      : quitYear;
  const years = endYear - detail.startYear;
  if (years < 0) return { value: null, status: "missing_inputs" };
  return {
    value: Math.round((detail.cigarettesPerDay / 20) * years * 10) / 10,
    status: "computed",
  };
}

/** Whole years smoked, from the same inputs as pack-years; null when unknown. */
export function yearsSmoked(
  smokingStatus: string | null,
  detail: TobaccoDetailValue | null,
  now: Date,
): number | null {
  if (!detail || detail.startYear === null) return null;
  const quitYear = detail.quitMonth
    ? Number(detail.quitMonth.slice(0, 4))
    : null;
  const endYear =
    smokingStatus === "CURRENT" || quitYear === null
      ? now.getUTCFullYear()
      : quitYear;
  const years = endYear - detail.startYear;
  return years >= 0 ? years : null;
}

// ── Activity ─────────────────────────────────────────────────────────────────

/** The Exercise Vital Sign product: days per week × minutes per day. */
export function activityMinutesPerWeek(
  daysPerWeek: number | null,
  minutesPerDay: number | null,
): { value: number | null; meetsWho150: boolean | null } {
  if (daysPerWeek === null || minutesPerDay === null) {
    return { value: null, meetsWho150: null };
  }
  const value = daysPerWeek * minutesPerDay;
  return { value, meetsWho150: value >= 150 };
}

// ── Free weekdays ────────────────────────────────────────────────────────────

/** Saturday and Sunday, the calendar default when nobody said otherwise. */
export const DEFAULT_FREE_WEEKDAYS: readonly number[] = [6, 7];

/** One dated answer to "which weekdays are free": `[validFrom, validUntil)`. */
export interface FreeWeekdaysSpan {
  validFrom: Date;
  validUntil: Date | null;
  days: readonly number[];
}

/**
 * Day type of a night from its wake day (`YYYY-MM-DD`), read against the
 * answer that was in force on that day. A night outside every answered span
 * falls back to the weekend default, so a free-days answer given last month
 * does not rewrite how last year's nights were read.
 */
export function dayTypeForNight(
  night: string,
  spans: readonly FreeWeekdaysSpan[],
): "work" | "free" {
  const [y, m, d] = night.split("-").map(Number);
  if (!y || !m || !d) return "work";
  const at = Date.UTC(y, m - 1, d, 12);
  const jsDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sun
  const isoDay = jsDay === 0 ? 7 : jsDay;
  const span = spans.find(
    (s) =>
      s.validFrom.getTime() <= at &&
      (s.validUntil === null || at < s.validUntil.getTime()),
  );
  const free = span ? span.days : DEFAULT_FREE_WEEKDAYS;
  return free.includes(isoDay) ? "free" : "work";
}

// ── Screening hints ──────────────────────────────────────────────────────────

export type ScreeningRegion = "DE" | "US";

export interface ScreeningHint {
  id: "lung_ldct" | "aaa_ultrasound";
  status: "suggested" | "not_eligible" | "unknown";
  reasonKeys: string[];
  region: ScreeningRegion;
  sourceLabel: string;
  sourceUrl: string;
}

/** The region of the hints follows the account language: German gives the German rules. */
export function screeningRegion(
  locale: string | null | undefined,
): ScreeningRegion {
  return locale === "de" ? "DE" : "US";
}

const SOURCES = {
  lung_ldct: {
    DE: {
      label:
        "G-BA, Beschluss vom 18.06.2025 zur Lungenkrebs-Früherkennung mittels Niedrigdosis-CT",
      url: "https://www.g-ba.de/presse/pressemitteilungen-meldungen/1263/",
    },
    US: {
      label: "USPSTF, Lung Cancer: Screening (2021)",
      url: "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening",
    },
  },
  aaa_ultrasound: {
    DE: {
      label:
        "G-BA, Ultraschallscreening auf Bauchaortenaneurysmen (Beschluss vom 20.10.2016)",
      url: "https://www.g-ba.de/institution/presse/pressemitteilungen/645/",
    },
    US: {
      label: "USPSTF, Abdominal Aortic Aneurysm: Screening (2019)",
      url: "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/abdominal-aortic-aneurysm-screening",
    },
  },
} as const;

export interface ScreeningInputs {
  ageYears: number | null;
  /** Profile sex as stored: MALE, FEMALE, OTHER or null. */
  sex: string | null;
  smokingStatus: string | null;
  detail: TobaccoDetailValue | null;
  packYears: PackYears;
  locale: string | null | undefined;
  now: Date;
}

function hint(
  id: ScreeningHint["id"],
  region: ScreeningRegion,
  locale: string | null | undefined,
  status: ScreeningHint["status"],
  reasonKeys: string[],
): ScreeningHint {
  const source = SOURCES[id][region];
  return {
    id,
    status,
    reasonKeys,
    region,
    sourceLabel: `${source.label} (${countryLabel(region, locale)})`,
    sourceUrl: source.url,
  };
}

/** Whole years since the quit month, or null for a current smoker or without one. */
function yearsSinceQuit(
  detail: TobaccoDetailValue | null,
  now: Date,
): number | null {
  if (!detail?.quitMonth) return null;
  const [y, m] = detail.quitMonth.split("-").map(Number);
  const months = (now.getUTCFullYear() - y) * 12 + (now.getUTCMonth() + 1 - m);
  return Math.max(0, Math.floor(months / 12));
}

/**
 * Low-dose CT for lung cancer.
 *  DE (G-BA, 18.06.2025): 50 to 75 years, at least 25 years smoked, at least
 *    15 pack-years, smoking now or stopped at most 10 years ago.
 *  US (USPSTF 2021): 50 to 80 years, at least 20 pack-years, smoking now or
 *    stopped within the past 15 years.
 */
function lungHint(
  input: ScreeningInputs,
  region: ScreeningRegion,
): ScreeningHint {
  const rule =
    region === "DE"
      ? { minAge: 50, maxAge: 75, minPackYears: 15, minYears: 25, maxQuit: 10 }
      : {
          minAge: 50,
          maxAge: 80,
          minPackYears: 20,
          minYears: null,
          maxQuit: 15,
        };
  if (input.smokingStatus === "NEVER") {
    return hint("lung_ldct", region, input.locale, "not_eligible", [
      "never_smoked",
    ]);
  }
  const failed: string[] = [];
  const missing: string[] = [];
  if (input.ageYears === null) missing.push("missing_birth_date");
  else if (input.ageYears < rule.minAge || input.ageYears > rule.maxAge) {
    failed.push("age_out_of_range");
  }
  if (input.smokingStatus === null) missing.push("missing_smoking_status");
  if (input.packYears.status === "not_applicable") failed.push("no_cigarettes");
  else if (input.packYears.value === null)
    missing.push("missing_smoking_history");
  else if (input.packYears.value < rule.minPackYears) {
    failed.push(
      region === "DE" ? "pack_years_below_15" : "pack_years_below_20",
    );
  }
  if (rule.minYears !== null) {
    const years = yearsSmoked(input.smokingStatus, input.detail, input.now);
    if (years === null) {
      if (!missing.includes("missing_smoking_history"))
        missing.push("missing_smoking_history");
    } else if (years < rule.minYears) failed.push("smoked_years_below_25");
  }
  if (input.smokingStatus === "FORMER") {
    const since = yearsSinceQuit(input.detail, input.now);
    if (since === null) missing.push("missing_quit_date");
    else if (since > rule.maxQuit) {
      failed.push(
        region === "DE" ? "quit_over_10_years" : "quit_over_15_years",
      );
    }
  }
  if (failed.length > 0)
    return hint("lung_ldct", region, input.locale, "not_eligible", failed);
  if (missing.length > 0)
    return hint("lung_ldct", region, input.locale, "unknown", missing);
  return hint("lung_ldct", region, input.locale, "suggested", []);
}

/**
 * Ultrasound for an abdominal aortic aneurysm.
 *  DE (G-BA): men from 65, once.
 *  US (USPSTF 2019): men 65 to 75 who have ever smoked.
 */
function aaaHint(
  input: ScreeningInputs,
  region: ScreeningRegion,
): ScreeningHint {
  const failed: string[] = [];
  const missing: string[] = [];
  if (input.sex === null) missing.push("missing_sex");
  else if (input.sex !== "MALE") failed.push("sex_not_male");
  if (input.ageYears === null) missing.push("missing_birth_date");
  else if (input.ageYears < 65 || (region === "US" && input.ageYears > 75)) {
    failed.push("age_out_of_range");
  }
  if (region === "US") {
    if (input.smokingStatus === "NEVER") failed.push("never_smoked");
    else if (input.smokingStatus === null)
      missing.push("missing_smoking_status");
  }
  if (failed.length > 0)
    return hint("aaa_ultrasound", region, input.locale, "not_eligible", failed);
  if (missing.length > 0)
    return hint("aaa_ultrasound", region, input.locale, "unknown", missing);
  return hint("aaa_ultrasound", region, input.locale, "suggested", []);
}

/** Both hints, always in this order. A hint, never a reminder: nothing is scheduled. */
export function screeningHints(input: ScreeningInputs): ScreeningHint[] {
  const region = screeningRegion(input.locale);
  return [lungHint(input, region), aaaHint(input, region)];
}

// ── Clinical summary ─────────────────────────────────────────────────────────

/**
 * What the doctor report and the FHIR export carry from the life
 * circumstances: pack-years, the newest AUDIT-C as a screening result,
 * activity and work. Diet and goals are deliberately absent (coach-only by
 * design): they are context for a conversation, not clinical findings.
 */
export interface LifeClinicalSummary {
  packYears: number | null;
  auditC: {
    id: string;
    takenAt: string;
    totalScore: number;
    aboveCutoff: boolean | null;
    cutoffValue: number | null;
    cutoffSourceLabel: string | null;
  } | null;
  activityMinutesPerWeek: number | null;
  sittingHoursWorkday: number | null;
  work: {
    situation: WorkContextValue["situation"];
    physicalNature: WorkContextValue["physicalNature"];
    nightWork: boolean | null;
    exposures: WorkContextValue["exposures"];
  } | null;
}
