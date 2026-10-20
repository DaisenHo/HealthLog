import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { Label } from "../label";

describe("<Label>", () => {
  it("lays out inline so the colon stays on the last word when it wraps", () => {
    const html = renderToStaticMarkup(
      <Label htmlFor="x">Body temperature</Label>,
    );
    expect(html).toContain("inline-block");
    // A flex box turns the ::after colon into a flex item of its own, which
    // floats beside a wrapped label instead of following its last word.
    expect(html).not.toMatch(/class="[^"]*\binline-flex\b/);
    expect(html).toContain("after:content-[&#x27;:&#x27;]");
  });

  it("drops the colon when asked", () => {
    const html = renderToStaticMarkup(
      <Label htmlFor="x" noColon>
        Note
      </Label>,
    );
    expect(html).toContain('data-no-colon="true"');
  });

  it("lets a call site take over the layout", () => {
    const html = renderToStaticMarkup(
      <Label htmlFor="x" className="flex items-baseline">
        Weight
      </Label>,
    );
    expect(html).toMatch(/class="[^"]*\bflex\b/);
    expect(html).not.toContain("inline-block");
  });
});
