import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { TrendTile } from "../trend-tile";

describe("<TrendTile>", () => {
  it("paints the tile frame on the card inset and clips its content", () => {
    const html = renderToStaticMarkup(<TrendTile>x</TrendTile>);
    for (const c of [
      "bg-card",
      "border",
      "rounded-xl",
      "p-4",
      "md:p-6",
      "h-full",
      "min-w-0",
      "overflow-hidden",
    ]) {
      expect(html).toContain(c);
    }
    expect(html).toContain('data-slot="trend-tile"');
    expect(html).not.toContain("shadow");
  });

  it("keeps the caller's slot, state and rhythm", () => {
    const html = renderToStaticMarkup(
      <TrendTile
        data-slot="vitals-tile"
        data-state="provisional"
        className="gap-3"
      >
        x
      </TrendTile>,
    );
    expect(html).toContain('data-slot="vitals-tile"');
    expect(html).toContain('data-state="provisional"');
    expect(html).toContain("gap-3");
  });
});
