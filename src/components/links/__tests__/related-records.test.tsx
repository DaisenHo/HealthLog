import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import type { RelatedLink } from "@/lib/links/related";

import { RelatedRecordsBlock, RelatedRecordsList } from "../related-records";

const RELATED: RelatedLink[] = [
  {
    kind: "conditionEpisode",
    id: "c1",
    label: "Hypothyroidism",
    date: "2026-01-20T00:00:00.000Z",
    href: "/illness/c1",
    via: "direct",
  },
  {
    kind: "encounter",
    id: "e1",
    label: "SPECIALIST",
    date: "2026-07-01T09:00:00.000Z",
    href: "/checkups?visit=e1",
    via: "direct",
  },
  {
    kind: "labResult",
    id: "l1",
    label: "TSH",
    date: "2026-06-30T09:00:00.000Z",
    href: "/labs/b1",
    via: "efficacyTarget",
  },
];

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">{node}</I18nProvider>,
  );
}

describe("<RelatedRecordsList>", () => {
  it("links every row to the path the server resolved", () => {
    const html = render(<RelatedRecordsList related={RELATED} />);
    expect(html).toContain('href="/illness/c1"');
    expect(html).toContain('href="/checkups?visit=e1"');
    expect(html).toContain('href="/labs/b1"');
    expect(html).toContain("Hypothyroidism");
  });

  it("names a visit labelled by its kind from the reader's bundle", () => {
    const html = render(<RelatedRecordsList related={RELATED} />);
    expect(html).not.toContain(">SPECIALIST<");
  });

  it("says how a derived relation runs", () => {
    const html = render(<RelatedRecordsList related={RELATED} />);
    expect(html).toContain("through the efficacy target");
  });

  it("leaves out the kinds the surface lists elsewhere, and renders nothing when empty", () => {
    const html = render(
      <RelatedRecordsList related={RELATED} omitKinds={["encounter"]} />,
    );
    expect(html).not.toContain("/checkups?visit=e1");
    expect(render(<RelatedRecordsList related={[]} />)).toBe("");
    expect(
      render(
        <RelatedRecordsBlock
          related={RELATED}
          omitKinds={["conditionEpisode", "encounter", "labResult"]}
        />,
      ),
    ).toBe("");
  });
});
