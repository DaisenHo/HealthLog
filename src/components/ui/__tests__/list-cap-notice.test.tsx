import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import { readListCap } from "@/lib/api/list-cap-shape";

import { ListCapNotice } from "../list-cap-notice";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<I18nProvider initialLocale="en">{node}</I18nProvider>);

describe("ListCapNotice", () => {
  it("says the list stopped at its ceiling, with the number", () => {
    const html = render(<ListCapNotice cap={{ truncated: true, limit: 50 }} />);
    expect(html).toContain('data-slot="list-cap-notice"');
    expect(html).toContain("Showing the latest 50");
  });

  it("renders nothing for a complete list or no cap", () => {
    expect(
      render(<ListCapNotice cap={{ truncated: false, limit: 50 }} />),
    ).toBe("");
    expect(render(<ListCapNotice cap={null} />)).toBe("");
  });
});

describe("readListCap", () => {
  it("reads the envelope's cap and nothing else", () => {
    expect(
      readListCap({ truncated: true, limit: 100, requestId: "r" }),
    ).toEqual({ truncated: true, limit: 100 });
    expect(readListCap({ aggregate: {} })).toBeNull();
    expect(readListCap({ truncated: "yes", limit: 1 })).toBeNull();
    expect(readListCap(undefined)).toBeNull();
  });
});
