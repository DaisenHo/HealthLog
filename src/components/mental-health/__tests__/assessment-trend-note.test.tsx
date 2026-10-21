import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/context";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

import { AssessmentTrendNote } from "../assessment-trend-note";
import type { AssessmentTrendDto } from "../types";

primeLocales("de");

const TREND: AssessmentTrendDto = {
  instrument: "PHQ9",
  n: 3,
  threshold: 5,
  higherIsBetter: false,
  first: { score: 16, takenAt: "2026-01-10T09:00:00.000Z" },
  previous: { score: 12, takenAt: "2026-03-15T09:00:00.000Z" },
  latest: { score: 9, takenAt: "2026-06-01T09:00:00.000Z" },
  changeFromPrevious: -3,
  changeFromFirst: -7,
  sincePrevious: "within_threshold",
  sinceFirst: "improved",
};

const render = (trend: AssessmentTrendDto, locale: "en" | "de" = "en") =>
  renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <AssessmentTrendNote trend={trend} />
    </I18nProvider>,
  );

describe("<AssessmentTrendNote>", () => {
  it("states each change and whether it reaches the threshold", () => {
    const html = render(TREND);
    expect(html).toContain("-3 points");
    expect(html).toContain("smaller than the 5-point change");
    expect(html).toContain("-7 points");
    expect(html).toContain('data-verdict="improved"');
  });

  it("shows a rise with its sign, in German with du", () => {
    const html = render(
      { ...TREND, n: 2, changeFromPrevious: 6, sincePrevious: "worsened" },
      "de",
    );
    expect(html).toContain("Seit deinem vorigen Check-in");
    expect(html).toContain("+6 Punkte");
    expect(html).not.toContain("ersten");
  });

  it("is silent with a single check-in", () => {
    expect(
      render({
        ...TREND,
        n: 1,
        previous: null,
        changeFromPrevious: null,
        changeFromFirst: null,
        sincePrevious: null,
        sinceFirst: null,
      }),
    ).toBe("");
  });
});
