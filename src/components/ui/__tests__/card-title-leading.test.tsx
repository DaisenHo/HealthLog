import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { CardTitle } from "../card";

/**
 * A card title wraps (`break-words hyphens-auto`), so its line height must
 * leave room between the lines: under `leading-none` a wrapped German
 * compound's two lines touched.
 */
describe("<CardTitle>", () => {
  it("wraps with room between the lines", () => {
    const html = renderToStaticMarkup(
      <CardTitle>Körperfettverteilung</CardTitle>,
    );
    expect(html).toContain("leading-tight");
    expect(html).not.toContain("leading-none");
  });

  it("counter-check: a caller's own leading still wins", () => {
    const html = renderToStaticMarkup(
      <CardTitle className="leading-snug">Puls</CardTitle>,
    );
    expect(html).toContain("leading-snug");
    expect(html).not.toContain("leading-tight");
  });
});
