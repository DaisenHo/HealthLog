import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { InlineAction } from "../inline-action";

describe("<InlineAction>", () => {
  it("is a non-submitting button with the touch floor and a focus ring", () => {
    const html = renderToStaticMarkup(
      <InlineAction>Open schedule</InlineAction>,
    );
    expect(html).toMatch(/^<button[^>]*type="button"/);
    expect(html).toContain("pointer-coarse:min-h-11");
    expect(html).toContain("focus-visible:ring-[3px]");
    expect(html).toContain("text-primary");
    expect(html).toContain("text-xs");
  });

  it("keeps an explicit submit type", () => {
    const html = renderToStaticMarkup(
      <InlineAction type="submit">Send</InlineAction>,
    );
    expect(html).toContain('type="submit"');
  });

  it("maps the tones and sizes", () => {
    const muted = renderToStaticMarkup(
      <InlineAction tone="muted" size="sm">
        x
      </InlineAction>,
    );
    expect(muted).toContain("text-muted-foreground");
    expect(muted).toContain("hover:text-foreground");
    expect(muted).toContain("text-sm");
    expect(muted).not.toContain("text-primary");
  });

  it("renders a link through asChild without a button type", () => {
    const html = renderToStaticMarkup(
      <InlineAction asChild tone="foreground">
        <a href="/insights/health-score" data-slot="history-link">
          History
        </a>
      </InlineAction>,
    );
    expect(html).toMatch(/^<a /);
    expect(html).not.toContain("type=");
    expect(html).toContain('data-slot="history-link"');
    expect(html).toContain("pointer-coarse:min-h-11");
  });
});
