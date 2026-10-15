/**
 * A picker search term that names a calendar period: a year, or a month of a
 * year.
 *
 * A person looking for "the lab panel from March 2019" types the date, not an
 * analyte. The list routes match `q` against names and titles only, so "2019"
 * or "03.2019" found nothing, or only whatever happened to carry those digits
 * in its name. A term that parses here is sent as the route's own `from` /
 * `to` window instead, so the answer is every record in that period, however
 * far back it sits.
 *
 * Accepted, after folding case, accents and the umlaut spellings "ae", "oe",
 * "ue" (so "März", "Maerz" and "mär" agree):
 *
 *   - a year: "2019" (Korean "2019년");
 *   - a numeric month and year, either order, separated by ".", "/", "-" or a
 *     space: "03.2019", "3.2019", "03/2019", "2019-03", "2019/03", "2019.03",
 *     Korean "2019년 3월" / "2019. 3.";
 *   - a month name and a year, either order, in the person's UI locale: the
 *     full name, the short name, the genitive form where the language has one
 *     (Polish "marca"), or any prefix of at least three letters that names one
 *     month only ("sept", "paź"; "jui" is both juin and juillet, so it is not
 *     a period). Spanish "de" may join the two ("marzo de 2019").
 *
 * The month names come from `Intl.DateTimeFormat` for the locale rather than a
 * table kept by hand, so they read the way the app's own dates are rendered.
 *
 * A year before {@link MIN_PERIOD_YEAR} or more than one year after the
 * current one is not a period ("1850" stays a text search), and neither is a
 * month outside 1 to 12 ("13.2019") or a term with anything else in it
 * ("2019abc", "LDL 2019").
 *
 * Pure: no provider, no clock unless the caller omits `now`.
 */
import { foldForMatch } from "@/lib/i18n/fold-for-match";
import { shiftDateKey } from "@/lib/tz/format";

/** The earliest year a period search accepts. */
export const MIN_PERIOD_YEAR = 1900;

export interface PeriodQuery {
  year: number;
  /** 1 to 12, or null for the whole year. */
  month: number | null;
  /** First calendar day of the period, `YYYY-MM-DD`. */
  fromDay: string;
  /** Last calendar day of the period, `YYYY-MM-DD` (inclusive). */
  toDay: string;
}

/** Words that may stand between a month name and its year. */
const CONNECTORS: Record<string, readonly string[]> = {
  es: ["de", "del"],
  it: ["del"],
};

const nameCache = new Map<string, ReadonlyArray<[string, number]>>();

/** Spell German umlauts the way a keyboard without them does. */
function umlautSpelling(lower: string): string {
  return lower.replace(/ä/gu, "ae").replace(/ö/gu, "oe").replace(/ü/gu, "ue");
}

/**
 * Every folded spelling of every month in `locale`, paired with its month
 * number: long, short and (where it differs) genitive, each also with its
 * umlauts spelled out.
 */
function monthNames(locale: string): ReadonlyArray<[string, number]> {
  const cached = nameCache.get(locale);
  if (cached) return cached;
  const names: Array<[string, number]> = [];
  const add = (raw: string, month: number) => {
    const lower = raw.toLowerCase().replace(/\./gu, "");
    for (const spelling of [lower, umlautSpelling(lower)]) {
      const folded = foldForMatch(spelling);
      if (folded && !names.some(([n, m]) => n === folded && m === month)) {
        names.push([folded, month]);
      }
    }
  };
  let long: Intl.DateTimeFormat;
  let short: Intl.DateTimeFormat;
  let genitive: Intl.DateTimeFormat;
  try {
    long = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" });
    short = new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: "UTC",
    });
    genitive = new Intl.DateTimeFormat(locale, {
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    nameCache.set(locale, names);
    return names;
  }
  for (let month = 1; month <= 12; month += 1) {
    const day = new Date(Date.UTC(2019, month - 1, 15));
    add(long.format(day), month);
    add(short.format(day), month);
    const part = genitive
      .formatToParts(day)
      .find((p) => p.type === "month")?.value;
    if (part) add(part, month);
  }
  nameCache.set(locale, names);
  return names;
}

/** The month a folded word names in `locale`, or null. */
function monthFromName(word: string, locale: string): number | null {
  const names = monthNames(locale);
  const exact = names.find(([name]) => name === word);
  if (exact) return exact[1];
  if (word.length < 3 || !/^\p{L}+$/u.test(word)) return null;
  const months = new Set(
    names.filter(([name]) => name.startsWith(word)).map(([, month]) => month),
  );
  return months.size === 1 ? [...months][0] : null;
}

function plausibleYear(word: string, now: Date): number | null {
  if (!/^\d{4}$/u.test(word)) return null;
  const year = Number(word);
  if (year < MIN_PERIOD_YEAR || year > now.getUTCFullYear() + 1) return null;
  return year;
}

function numericMonth(word: string): number | null {
  if (!/^\d{1,2}$/u.test(word)) return null;
  const month = Number(word);
  return month >= 1 && month <= 12 ? month : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function period(year: number, month: number | null): PeriodQuery {
  if (month === null) {
    return { year, month, fromDay: `${year}-01-01`, toDay: `${year}-12-31` };
  }
  const fromDay = `${year}-${pad(month)}-01`;
  const nextMonth =
    month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
  return { year, month, fromDay, toDay: shiftDateKey(nextMonth, -1) };
}

/** The base language of a locale tag: "de-AT" → "de". */
function language(locale: string): string {
  return locale.toLowerCase().split(/[-_]/u)[0] ?? "";
}

/**
 * The period `term` names in `locale`, or null when it is not one (and the
 * picker keeps its text search).
 */
export function parsePeriodQuery(
  term: string,
  locale: string,
  now: Date = new Date(),
): PeriodQuery | null {
  const lang = language(locale);
  let text = term.toLowerCase();
  // Korean writes the units after the numbers: "2019년 3월".
  if (lang === "ko") {
    text = text.replace(/(\d)\s*년/gu, "$1 ").replace(/(\d)\s*월/gu, "$1 ");
  }
  const connectors = CONNECTORS[lang] ?? [];
  const words = foldForMatch(text.replace(/[.,]/gu, " "))
    .split(" ")
    .filter((word) => word.length > 0 && !connectors.includes(word));

  if (words.length === 1) {
    const year = plausibleYear(words[0], now);
    return year === null ? null : period(year, null);
  }
  if (words.length !== 2) return null;

  for (const [first, second] of [
    [words[0], words[1]],
    [words[1], words[0]],
  ]) {
    const year = plausibleYear(second, now);
    if (year === null) continue;
    const month = numericMonth(first) ?? monthFromName(first, locale);
    if (month !== null) return period(year, month);
  }
  return null;
}

/** The period as the app names it in `locale`: "2019", "März 2019". */
export function formatPeriod(value: PeriodQuery, locale: string): string {
  if (value.month === null) return String(value.year);
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(value.year, value.month - 1, 15)));
  } catch {
    return `${pad(value.month)}.${value.year}`;
  }
}
