import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Moon } from "lucide-react";

import { I18nProvider } from "@/lib/i18n/context";
import { MetricCrosstab, type MetricCrosstabRow } from "../metric-crosstab";

function row(overrides: Partial<MetricCrosstabRow> = {}): MetricCrosstabRow {
  return {
    key: "a",
    metricKey: "restingHeartRate",
    pairLabel: "Resting heart rate",
    up: true,
    deltaValue: "2,5",
    unit: "bpm",
    confidence: "medium",
    detail: "62 vs 59.5 bpm",
    ...overrides,
  };
}

function render(rows: MetricCrosstabRow[]) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <MetricCrosstab
        slot="board"
        rowSlot="board-row"
        description="How it differs"
        rows={rows}
      />
    </I18nProvider>,
  );
}

describe("<MetricCrosstab>", () => {
  it("renders nothing for no rows", () => {
    expect(render([])).toBe("");
  });

  it("prints the delta as given, signed, and never coloured", () => {
    const html = render([row()]);
    expect(html).toContain('data-slot="board"');
    expect(html).toContain('data-slot="board-row"');
    expect(html).toContain("+2,5 bpm");
    expect(html).toContain('data-direction="up"');
    expect(html).not.toMatch(/text-(success|destructive)/);
  });

  it("leaves a negative delta's own sign alone", () => {
    const html = render([row({ up: false, deltaValue: "-1,2" })]);
    expect(html).toContain("-1,2 bpm");
    expect(html).not.toContain("+-1,2");
    expect(html).toContain('data-direction="down"');
  });

  it("states confidence through the grade chip", () => {
    const html = render([row({ confidence: "high" })]);
    expect(html).toMatch(/data-slot="score-pill"[^>]*data-tone="success"/);
    expect(html).toContain("High confidence");
  });

  it("draws the row icon when one is given", () => {
    expect(render([row({ icon: Moon })])).toContain("<svg");
    expect(render([row()])).not.toContain("<svg");
  });

  it("collapses a dismissed pattern to its notice", () => {
    const html = render([row({ patternId: "p1", dismissed: true })]);
    expect(html).not.toContain('data-slot="board-row"');
  });
});
