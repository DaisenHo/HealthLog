import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PageHeader } from "../page-header";

describe("<PageHeader> heading options", () => {
  it("is a plain h1 by default, with no tab stop", () => {
    const html = renderToStaticMarkup(<PageHeader title="Pulse" />);
    expect(html).toMatch(
      /<h1[^>]*class="[^"]*text-2xl font-bold tracking-tight/,
    );
    expect(html).not.toContain("tabindex");
  });

  it("becomes a programmatic focus target with a visible ring", () => {
    const ref = createRef<HTMLHeadingElement>();
    const html = renderToStaticMarkup(
      <PageHeader title="Pulse" titleId="t" headingRef={ref} focusable />,
    );
    expect(html).toMatch(/<h1[^>]*tabindex="-1"/);
    expect(html).toContain("focus-visible:ring-2");
  });

  it("keeps the accessory beside the heading, outside its name", () => {
    const html = renderToStaticMarkup(
      <PageHeader title="Pulse" titleAccessory={<span>Beta</span>} />,
    );
    expect(html).toMatch(/<h1[^>]*>Pulse<\/h1><span>Beta<\/span>/);
  });
});
