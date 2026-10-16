import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import { NUTRIENT_CATALOG } from "@/lib/nutrients/catalog";

import type { NutrientOverviewRow } from "../types";

const state = vi.hoisted(() => ({ rows: [] as NutrientOverviewRow[] }));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: { nutrients: state.rows },
    isLoading: false,
    isError: false,
    refetch: () => undefined,
  }),
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { gender: "MALE" } }),
}));

import { MicronutrientsCard } from "../micronutrients-card";

function render(rows: NutrientOverviewRow[], locale: "en" | "de" = "en") {
  state.rows = rows;
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <MicronutrientsCard />
    </I18nProvider>,
  );
}

function row(nutrient: "vitamin_a" | "vitamin_d"): NutrientOverviewRow {
  return {
    nutrient,
    unit: "ug",
    latestDay: "2026-10-15",
    latestAmount: 4000,
    daysWithData: 3,
    upperLimit: NUTRIENT_CATALOG[nutrient].upperLimit,
    latestAboveUpperLimit: true,
  };
}

/**
 * The upper limit of vitamin A is set for preformed retinol; beta-carotene
 * does not count toward it. The amount on file cannot say which form it came
 * in, so the note says what the level covers, in the reader's language, and
 * the citation stays a bare citation.
 */
describe("MicronutrientsCard upper-limit note", () => {
  it("says the vitamin A level covers retinol only", () => {
    const html = render([row("vitamin_a")]);
    expect(html).toContain('data-slot="nutrients-upper-limit-note"');
    expect(html).toContain("preformed vitamin A (retinol) only");
    expect(html).toContain("beta-carotene");
    expect(html).toContain("(EFSA UL overview 2024 (SCF 2002))");
  });

  it("phrases the note in the reader's language, not the citation's", () => {
    const html = render([row("vitamin_a")], "de");
    expect(html).toContain("Höchstmenge für Erwachsene");
    expect(html).toContain("Beta-Carotin");
    expect(html).not.toContain("adults");
  });

  it("adds no form sentence where the level covers the nutrient as such", () => {
    const html = render([row("vitamin_d")]);
    expect(html).toContain('data-slot="nutrients-upper-limit-note"');
    expect(html).not.toContain("The level covers");
  });
});
