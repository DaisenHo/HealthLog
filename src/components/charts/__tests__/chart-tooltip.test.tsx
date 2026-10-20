import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { RichChartTooltip } from "../chart-tooltip";

/**
 * v1.4.16 — Apple-Health-style tooltip primitive contract.
 */
describe("<RichChartTooltip>", () => {
  it("renders nothing when inactive", () => {
    const html = renderToStaticMarkup(
      <RichChartTooltip
        active={false}
        rows={[{ name: "Systolic", value: "128 mmHg", color: "#bd93f9" }]}
      />,
    );
    expect(html).toBe("");
  });

  it("renders nothing when active but row list is empty", () => {
    const html = renderToStaticMarkup(<RichChartTooltip active rows={[]} />);
    expect(html).toBe("");
  });

  it("renders the date label and one value row when active with a single row", () => {
    const html = renderToStaticMarkup(
      <RichChartTooltip
        active
        label="Mon, May 5"
        rows={[
          {
            name: "Systolic",
            value: "128 mmHg",
            color: "#bd93f9",
            delta: "+3 vs. your normal",
          },
        ]}
      />,
    );

    expect(html).toContain("Mon, May 5");
    expect(html).toContain("Systolic");
    expect(html).toContain("128 mmHg");
    expect(html).toContain("+3 vs. your normal");
    // Marker hooks for e2e + visual.
    expect(html).toContain('data-slot="rich-chart-tooltip"');
    expect(html).toContain('data-slot="rich-chart-tooltip-label"');
    expect(html).toContain('data-slot="rich-chart-tooltip-row"');
    expect(html).toContain('data-slot="rich-chart-tooltip-delta"');
    // Coloured dot uses the row colour (inline style).
    expect(html).toContain("background-color:#bd93f9");
  });

  it("supports multiple rows and omits delta sub-line when not provided", () => {
    const html = renderToStaticMarkup(
      <RichChartTooltip
        active
        label="May 5"
        rows={[
          { name: "Systolic", value: "128 mmHg", color: "#bd93f9" },
          { name: "Diastolic", value: "82 mmHg", color: "#ff79c6" },
        ]}
      />,
    );
    expect(html).toContain("Systolic");
    expect(html).toContain("Diastolic");
    expect(html).toContain("128 mmHg");
    expect(html).toContain("82 mmHg");
    // No delta block painted when no delta supplied.
    expect(html).not.toContain('data-slot="rich-chart-tooltip-delta"');
  });

  it("hides the date label when label is empty string", () => {
    const html = renderToStaticMarkup(
      <RichChartTooltip
        active
        label=""
        rows={[{ name: "Mood", value: "4.2", color: "#d6acff" }]}
      />,
    );
    expect(html).not.toContain('data-slot="rich-chart-tooltip-label"');
    expect(html).toContain("Mood");
  });
});
