import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CoverageMeter } from "../coverage-meter";
import { I18nProvider } from "@/lib/i18n/context";
import type {
  DerivedConfidence,
  DerivedCoverage,
} from "@/lib/insights/derived/types";

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const FULL: DerivedCoverage = {
  requiredInputs: 5,
  presentInputs: 5,
  historyDays: 30,
  missing: [],
};
const PARTIAL: DerivedCoverage = {
  requiredInputs: 5,
  presentInputs: 3,
  historyDays: 12,
  missing: ["HRV_SDNN", "RESTING_HEART_RATE"],
};
const EMPTY: DerivedCoverage = {
  requiredInputs: 5,
  presentInputs: 0,
  historyDays: 0,
  missing: ["WEIGHT", "HRV_SDNN", "RESTING_HEART_RATE", "VO2_MAX", "SLEEP"],
};
const HIGH: DerivedConfidence = { score: 90, band: "high" };
const LOW: DerivedConfidence = { score: 35, band: "low" };

describe("<CoverageMeter>", () => {
  it("renders the root data-slot and ratio attributes (populated)", () => {
    const html = render(<CoverageMeter coverage={FULL} confidence={HIGH} />);
    expect(html).toContain('data-slot="coverage-meter"');
    expect(html).toContain('data-present="5"');
    expect(html).toContain('data-required="5"');
    expect(html).toContain('data-band="high"');
  });

  it("lights all dots at full confidence", () => {
    const html = render(<CoverageMeter coverage={FULL} confidence={HIGH} />);
    const lit = (html.match(/data-dot-state="lit"/g) ?? []).length;
    expect(lit).toBe(5);
    // Semantic --success token — AA-safe on the white card in light mode.
    expect(html).toContain("bg-success");
  });

  it("lights a partial number of dots and tints by band (provisional)", () => {
    const html = render(<CoverageMeter coverage={PARTIAL} confidence={LOW} />);
    const lit = (html.match(/data-dot-state="lit"/g) ?? []).length;
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThan(5);
    // The four confidence bands collapse onto three semantic severities;
    // low rides the caution --warning (medium↔low told apart by lit-dot
    // count + percent, never colour alone).
    expect(html).toContain("bg-warning");
    expect(html).toContain('data-percent="35"');
  });

  it("falls back to the present/required ratio when confidence is absent", () => {
    const html = render(<CoverageMeter coverage={PARTIAL} />);
    // 3/5 = 60%
    expect(html).toContain('data-percent="60"');
  });

  it("renders zero lit dots for the empty/insufficient state", () => {
    const html = render(<CoverageMeter coverage={EMPTY} />);
    const lit = (html.match(/data-dot-state="lit"/g) ?? []).length;
    expect(lit).toBe(0);
    expect(html).toContain('data-percent="0"');
  });

  it("carries an accessible summary label", () => {
    const html = render(<CoverageMeter coverage={PARTIAL} confidence={LOW} />);
    // The visible ratio plus the sentence, never an aria-label that drops
    // the ratio (WCAG 2.5.3).
    expect(html).not.toContain("aria-label");
    expect(html).toContain('class="sr-only">3 of 5 inputs (35%)</span>');
    expect(html).toContain("3");
    expect(html).toContain("5");
  });
});
