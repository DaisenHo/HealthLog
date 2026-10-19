/**
 * v1.43 (#614) — AUDIT-C, the alcohol section of the life circumstances.
 *
 * Three items of the WHO AUDIT, 0 to 4 points each, total 0 to 12. A
 * screening result, never a diagnosis: the read route shows the sum and, when
 * the profile states a sex, whether it reaches the screening cut-off of the
 * entry's country, with that source named.
 *
 * Cut-offs follow the language of the entry, because the validated wording a
 * person answered is the one the national cut-off was set against:
 *  - `de`: German S3 guideline on alcohol-related disorders (AWMF 076-001):
 *    men 5, women 4.
 *  - `ko`: Korean AUDIT-C cut-offs from KNHANES data: men 5, women 4.
 *  - every other language: Bradley et al. 2007 (US primary care): men 4,
 *    women 3.
 * A profile without a sex, or with `OTHER`, gets no cut-off at all: the
 * tables have no third row, and picking one of the two would be a guess.
 *
 * The item wording lives in `instruments.ts` (`AUDIT_C_ITEMS`), with the
 * source of every translation beside it.
 */
import { binaryReferenceSex } from "@/lib/profile/sex";
import { countryLabel } from "@/lib/profile/country-label";
import {
  AUDIT_C_ATTRIBUTION,
  AUDIT_C_ITEMS,
  AUDIT_C_STANDARD_DRINK,
} from "@/lib/mental-health/instruments";

export type AuditCCutoffSource =
  "S3_ALCOHOL_DE" | "KNHANES_KR" | "BRADLEY_2007";

export interface AuditCCutoff {
  value: number;
  sex: "male" | "female";
  source: AuditCCutoffSource;
  sourceLabel: string;
  sourceUrl: string;
}

const CUTOFFS: Readonly<
  Record<
    AuditCCutoffSource,
    {
      male: number;
      female: number;
      citation: string;
      country: "DE" | "KR" | "US";
      url: string;
    }
  >
> = {
  S3_ALCOHOL_DE: {
    male: 5,
    female: 4,
    citation:
      "S3-Leitlinie Screening, Diagnose und Behandlung alkoholbezogener Störungen (AWMF 076-001)",
    country: "DE",
    url: "https://alkoholleitlinie.de/diagnostik/test-audit-c/",
  },
  KNHANES_KR: {
    male: 5,
    female: 4,
    citation:
      "AUDIT-C cut-offs from the Korea National Health and Nutrition Examination Survey (KNHANES)",
    country: "KR",
    url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC6039362",
  },
  BRADLEY_2007: {
    male: 4,
    female: 3,
    citation: "Bradley KA et al., Alcohol Clin Exp Res 2007;31(7):1208-1217",
    country: "US",
    url: "https://onlinelibrary.wiley.com/doi/10.1111/j.1530-0277.2007.00403.x",
  },
};

/** The cut-off table an entry in this language is read against. */
export function auditCCutoffSource(locale: string): AuditCCutoffSource {
  if (locale === "de") return "S3_ALCOHOL_DE";
  if (locale === "ko") return "KNHANES_KR";
  return "BRADLEY_2007";
}

/**
 * The cut-off for an entry's language and the profile's sex; null when the
 * profile states no binary sex. `labelLocale` is the language the source line
 * is written for (the account's), so the country reads in that language.
 */
export function auditCCutoff(
  entryLocale: string,
  sex: string | null,
  labelLocale: string,
): AuditCCutoff | null {
  const binary = binaryReferenceSex(sex);
  if (!binary) return null;
  const source = auditCCutoffSource(entryLocale);
  const row = CUTOFFS[source];
  const key = binary === "MALE" ? "male" : "female";
  return {
    value: row[key],
    sex: key,
    source,
    sourceLabel: `${row.citation} (${countryLabel(row.country, labelLocale)})`,
    sourceUrl: row.url,
  };
}

export function auditCTotal(items: readonly number[]): number {
  return items.reduce((sum, item) => sum + item, 0);
}

/** The app languages; anything else is read as English. */
const APP_LOCALES = ["de", "en", "es", "fr", "it", "pl", "ko", "nl"] as const;

/** Normalise a requested or stored locale onto the app languages. */
export function normaliseAuditCLocale(
  locale: string | null | undefined,
): string {
  const base = (locale ?? "en").slice(0, 2).toLowerCase();
  return (APP_LOCALES as readonly string[]).includes(base) ? base : "en";
}

/** Whether `locale` has a validated translation of the three items. */
export function isValidatedAuditCLocale(locale: string): boolean {
  return locale in AUDIT_C_ITEMS;
}

export interface AuditCInstrument {
  items: Array<{
    stem: string;
    options: Array<{ value: number; label: string }>;
  }>;
  locale: string;
  validatedLocale: boolean;
  standardDrink: string;
  attribution: string;
}

/**
 * The instrument as a client renders it: the three items verbatim in the
 * account language when a validated translation exists, the WHO English
 * original otherwise (`validatedLocale: false`). Never a translation of our
 * own. The standard-drink sentence is help text in the account language.
 */
export function auditCInstrument(
  accountLocale: string | null | undefined,
): AuditCInstrument {
  const locale = normaliseAuditCLocale(accountLocale);
  const wording = AUDIT_C_ITEMS[locale] ?? AUDIT_C_ITEMS.en;
  return {
    items: wording.items.map((item) => ({
      stem: item.stem,
      options: item.options.map((label, value) => ({ value, label })),
    })),
    locale: wording.locale,
    validatedLocale: wording.locale === locale,
    standardDrink: AUDIT_C_STANDARD_DRINK[locale] ?? AUDIT_C_STANDARD_DRINK.en,
    attribution: AUDIT_C_ATTRIBUTION,
  };
}
