/**
 * A picker term that names a year or a month becomes a date window; anything
 * else stays a text search. Every accepted form is checked in every UI
 * locale, and the near misses that must stay text are checked too.
 */
import { describe, expect, it } from "vitest";

import { formatPeriod, parsePeriodQuery } from "../period-query";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const LOCALES = ["de", "en", "es", "fr", "it", "pl", "ko", "nl"] as const;

function window(term: string, locale: string) {
  const parsed = parsePeriodQuery(term, locale, NOW);
  return parsed ? `${parsed.fromDay}..${parsed.toDay}` : null;
}

const MARCH = "2019-03-01..2019-03-31";
const YEAR = "2019-01-01..2019-12-31";

describe("parsePeriodQuery", () => {
  describe.each(LOCALES)("%s", (locale) => {
    it("reads a year", () => {
      expect(window("2019", locale)).toBe(YEAR);
      expect(window("  2019  ", locale)).toBe(YEAR);
    });

    it.each([
      "03.2019",
      "3.2019",
      "03/2019",
      "3/2019",
      "03-2019",
      "2019-03",
      "2019/03",
      "2019.03",
      "2019.3",
      " 03 . 2019 ",
    ])("reads the numeric month %j", (term) => {
      expect(window(term, locale)).toBe(MARCH);
    });

    it.each(["LDL", "2019abc", "13.2019", "00.2019", "1850", "1899", "2028"])(
      "leaves %j as text",
      (term) => {
        expect(window(term, locale)).toBeNull();
      },
    );

    it.each(["", "   ", "2019 2020", "03.2019.04", "LDL 2019", "3 2019 x"])(
      "leaves %j as text",
      (term) => {
        expect(window(term, locale)).toBeNull();
      },
    );
  });

  it.each([
    ["de", ["März 2019", "märz 2019", "MÄRZ 2019", "Maerz 2019", "Marz 2019"]],
    ["de", ["mär 2019", "Mär. 2019", "2019 März", "März, 2019"]],
    ["en", ["March 2019", "march 2019", "Mar 2019", "Mar. 2019", "2019 March"]],
    ["es", ["marzo 2019", "Marzo de 2019", "mar 2019", "mar. 2019"]],
    ["fr", ["mars 2019", "Mars 2019", "mar 2019", "2019 mars"]],
    ["it", ["marzo 2019", "Marzo 2019", "mar 2019", "marzo del 2019"]],
    ["pl", ["marzec 2019", "Marzec 2019", "marca 2019", "mar 2019"]],
    ["ko", ["2019년 3월", "2019년3월", "2019년 03월", "3월 2019", "2019. 3."]],
  ] as const)("reads March 2019 in %s", (locale, terms) => {
    for (const term of terms) {
      expect(window(term, locale), term).toBe(MARCH);
    }
  });

  it.each([
    ["de", "Dezember 2019", "2019-12-01..2019-12-31"],
    ["de", "Okt 2019", "2019-10-01..2019-10-31"],
    ["de", "Februar 2020", "2020-02-01..2020-02-29"],
    ["en", "Sept 2019", "2019-09-01..2019-09-30"],
    ["en", "Sep 2019", "2019-09-01..2019-09-30"],
    ["en", "May 2019", "2019-05-01..2019-05-31"],
    ["es", "septiembre 2019", "2019-09-01..2019-09-30"],
    ["es", "ene 2019", "2019-01-01..2019-01-31"],
    ["es", "dic 2019", "2019-12-01..2019-12-31"],
    ["fr", "février 2019", "2019-02-01..2019-02-28"],
    ["fr", "fevrier 2019", "2019-02-01..2019-02-28"],
    ["fr", "févr. 2019", "2019-02-01..2019-02-28"],
    ["fr", "août 2019", "2019-08-01..2019-08-31"],
    ["fr", "déc 2019", "2019-12-01..2019-12-31"],
    ["fr", "juil. 2019", "2019-07-01..2019-07-31"],
    ["it", "gennaio 2019", "2019-01-01..2019-01-31"],
    ["it", "giu 2019", "2019-06-01..2019-06-30"],
    ["it", "set 2019", "2019-09-01..2019-09-30"],
    ["pl", "październik 2019", "2019-10-01..2019-10-31"],
    ["pl", "paź 2019", "2019-10-01..2019-10-31"],
    ["pl", "października 2019", "2019-10-01..2019-10-31"],
    ["pl", "luty 2019", "2019-02-01..2019-02-28"],
    ["pl", "styczeń 2019", "2019-01-01..2019-01-31"],
    ["ko", "2019년 12월", "2019-12-01..2019-12-31"],
    ["ko", "2019년", YEAR],
    // Austrian German calls January "Jänner", and Intl knows it.
    ["de-AT", "Jänner 2019", "2019-01-01..2019-01-31"],
    ["de-AT", "März 2019", MARCH],
  ] as const)("%s %j", (locale, term, expected) => {
    expect(window(term, locale)).toBe(expected);
  });

  it.each([
    // "jui" is both juin and juillet; "ma" is too short to name one month.
    ["fr", "jui 2019"],
    ["en", "ma 2019"],
    ["en", "Ju 2019"],
    // A month name from another language is text in this one.
    ["en", "März 2019"],
    ["de", "March 2019"],
    // A month without a year is not a period.
    ["en", "March"],
    ["de", "03"],
    // Two months, or a month name with digits glued on.
    ["en", "March May"],
    ["en", "March2019"],
  ] as const)("%s %j stays text", (locale, term) => {
    expect(window(term, locale)).toBeNull();
  });

  it("accepts next year and refuses the one after", () => {
    expect(window("2027", "en")).toBe("2027-01-01..2027-12-31");
    expect(window("12.2027", "en")).toBe("2027-12-01..2027-12-31");
    expect(window("2028", "en")).toBeNull();
    expect(window("1900", "en")).toBe("1900-01-01..1900-12-31");
  });

  it("names the year and the month", () => {
    expect(parsePeriodQuery("2019", "de", NOW)).toEqual({
      year: 2019,
      month: null,
      fromDay: "2019-01-01",
      toDay: "2019-12-31",
    });
    expect(parsePeriodQuery("Maerz 2019", "de", NOW)).toMatchObject({
      year: 2019,
      month: 3,
    });
  });
});

describe("formatPeriod", () => {
  it("names a period the way the locale writes it", () => {
    const march = parsePeriodQuery("03.2019", "de", NOW)!;
    expect(formatPeriod(march, "de")).toBe("März 2019");
    expect(formatPeriod(march, "en")).toBe("March 2019");
    expect(formatPeriod(march, "ko")).toBe("2019년 3월");
    expect(formatPeriod(parsePeriodQuery("2019", "en", NOW)!, "en")).toBe(
      "2019",
    );
  });
});
