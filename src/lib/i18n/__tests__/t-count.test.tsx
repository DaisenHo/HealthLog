import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, useTranslations } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/config";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de", "pl");

/**
 * `tCount` is the plural-aware `t` the components call.
 *
 * The tier selection lives on the context rather than in a helper each
 * component imports, because a new module edge from a widely-instantiated
 * component duplicates that module into every chunk containing it. That makes
 * the context the only place the Polish third plural tier is exercised from the
 * UI, so it needs its own coverage — the pure `pluralTier` tests cannot see a
 * regression in this wiring.
 */

function Probe({ base, count }: { base: string; count: number }) {
  const { tCount } = useTranslations();
  return <>{tCount(base, count)}</>;
}

function render(locale: Locale, base: string, count: number): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <Probe base={base} count={count} />
    </I18nProvider>,
  );
}

describe("tCount", () => {
  it("resolves the Polish few form for 2-4 and the many form for 5+", () => {
    expect(render("pl", "dashboard.staleHintWeeks", 3)).toBe(
      "Ostatni odczyt 3 tygodnie temu",
    );
    expect(render("pl", "dashboard.staleHintWeeks", 7)).toBe(
      "Ostatni odczyt 7 tygodni temu",
    );
    expect(render("pl", "dashboard.staleHintMonths", 2)).toBe(
      "Ostatni odczyt 2 miesiące temu",
    );
    expect(render("pl", "dashboard.staleHintMonths", 8)).toBe(
      "Ostatni odczyt 8 miesięcy temu",
    );
  });

  it("keeps the singular for 1", () => {
    expect(render("pl", "dashboard.staleHintWeeks", 1)).toBe(
      "Ostatni odczyt 1 tydzień temu",
    );
    expect(render("en", "dashboard.staleHintWeeks", 1)).toBe(
      "Last reading 1 week ago",
    );
  });

  it("leaves a locale without a few category on its two forms", () => {
    expect(render("en", "dashboard.staleHintWeeks", 3)).toBe(
      "Last reading 3 weeks ago",
    );
    expect(render("de", "dashboard.staleHintMonths", 3)).toBe(
      "Letzter Wert vor 3 Monaten",
    );
  });
});
