import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n/context";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

import { LabTrendCard } from "../lab-trend-card";
import type { BiomarkerTrendDto } from "../types";

primeLocales("de");

const OK: BiomarkerTrendDto = {
  status: "ok",
  n: 4,
  firstAt: "2023-01-10",
  lastAt: "2026-01-10",
  spanDays: 1096,
  slopePerYear: 12.5,
  slopeCi95: [4.25, 20.75],
  pValue: 0.02,
  fittedNow: 130,
  asOf: "2026-10-21",
  projection: "exits",
  exitDate: "2027-11-02",
  exitBound: "high",
};

function render(
  trend: BiomarkerTrendDto | undefined,
  locale: "en" | "de" = "en",
) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <LabTrendCard trend={trend} unit="mg/dL" />
    </I18nProvider>,
  );
}

describe("<LabTrendCard>", () => {
  it("words the server's slope and labels the exit as a projection", () => {
    const html = render(OK);
    expect(html).toContain("Rising by about 13 mg/dL a year across 4 readings");
    expect(html).toContain('data-projection="exits"');
    expect(html).toContain("upper end of your reference range");
    expect(html).toContain("projection, not a forecast");
    expect(html).toContain("4.25 to 20.75 mg/dL");
  });

  it("speaks German with du", () => {
    const html = render(OK, "de");
    expect(html).toContain("deines Referenzbereichs");
    expect(html).toContain("Fortschreibung, keine Vorhersage");
  });

  it("draws no projection sentence without a clear trend, and nothing when insufficient", () => {
    const html = render({
      ...OK,
      projection: "no_clear_trend",
      exitDate: null,
      exitBound: null,
    });
    expect(html).toContain('data-projection="no_clear_trend"');
    expect(html).not.toContain("forecast");
    expect(
      render({
        status: "insufficient",
        reason: "too_few_values",
        n: 2,
        spanDays: 40,
      }),
    ).toBe("");
    expect(render(undefined)).toBe("");
  });
});
