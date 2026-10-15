/**
 * The link picker over a list that pages on the server.
 *
 * A visit's link pickers used to offer one capped page and nothing past it.
 * Paged, three things have to hold: what the record already links shows
 * whether or not a loaded page holds it, the sheet offers the paging the
 * server reports, and an empty first window is not read as "nothing to link".
 *
 * ResponsiveSheet portals its body, which static markup does not render, so it
 * is mocked down to a wrapper that always shows its children.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FlaskConical } from "lucide-react";

vi.mock("@/components/ui/responsive-sheet", () => ({
  ResponsiveSheet: ({ children }: { children: React.ReactNode }) => (
    <div data-slot="mock-sheet">{children}</div>
  ),
}));

import { I18nProvider } from "@/lib/i18n/context";
import {
  EntityLinkPicker,
  resolvableOptions,
  type EntityLinkOption,
  type EntityLinkServerPaging,
} from "../entity-link-picker";
import { mergeWindowPages, uniqueById } from "../use-link-picker-pages";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">{node}</I18nProvider>,
  );
}

const server = (over: Partial<EntityLinkServerPaging> = {}) => ({
  term: "",
  onTermChange: () => undefined,
  searchPending: false,
  hasOlder: false,
  hasNewer: false,
  loadingOlder: false,
  loadingNewer: false,
  onOlder: () => undefined,
  onNewer: () => undefined,
  ...over,
});

const base = {
  icon: FlaskConical,
  title: "Lab results",
  slot: "labs",
  searchPlaceholder: "Search",
  emptyLabel: "Nothing to link",
  pending: false,
  onChange: () => undefined,
};

const loaded: EntityLinkOption[] = [
  { id: "recent", label: "Glucose", dateLabel: "12.05.2026" },
];
const linked2019: EntityLinkOption = {
  id: "ferritin-2019",
  label: "Ferritin",
  dateLabel: "03.04.2019",
};

describe("paged link picker", () => {
  it("a linked record outside every loaded page still shows as a chip and in the sheet", () => {
    const html = render(
      <EntityLinkPicker
        {...base}
        options={loaded}
        selected={["ferritin-2019"]}
        knownOptions={[linked2019]}
        server={server({ hasOlder: true })}
      />,
    );
    expect(html).toContain('data-slot="labs-chip"');
    expect(html).toContain("Ferritin");
    expect(html).toContain("03.04.2019");
    // In the sheet, on top under its own heading.
    expect(html).toContain("Linked");
  });

  it("offers older and newer pages while the server reports them", () => {
    const html = render(
      <EntityLinkPicker
        {...base}
        options={loaded}
        selected={[]}
        server={server({ hasOlder: true, hasNewer: true })}
      />,
    );
    expect(html).toContain('data-slot="labs-load-older"');
    expect(html).toContain('data-slot="labs-load-newer"');
    expect(html).toContain("Load older");
    expect(html).toContain("Load newer");
  });

  it("offers no paging once the server has no more", () => {
    const html = render(
      <EntityLinkPicker
        {...base}
        options={loaded}
        selected={[]}
        server={server()}
      />,
    );
    expect(html).not.toContain('data-slot="labs-load-older"');
    expect(html).not.toContain('data-slot="labs-load-newer"');
  });

  it("an empty first window with more to page is not 'nothing to link'", () => {
    const html = render(
      <EntityLinkPicker
        {...base}
        options={[]}
        selected={[]}
        server={server({ hasNewer: true })}
      />,
    );
    expect(html).not.toContain("Nothing to link");
    expect(html).toContain('data-slot="labs-add"');
  });

  it("does not filter a server answer again by the term", () => {
    // The route matched on the panel name; the option does not render it.
    const html = render(
      <EntityLinkPicker
        {...base}
        options={loaded}
        selected={[]}
        server={server({ term: "metabolic" })}
      />,
    );
    expect(html).toContain('data-slot="labs-option"');
  });

  it("a route without search filters what is loaded", () => {
    const html = render(
      <EntityLinkPicker
        {...base}
        options={loaded}
        selected={[]}
        server={server({ term: "nomatch", filterLocally: true })}
      />,
    );
    expect(html).not.toContain('data-slot="labs-option"');
  });
});

describe("resolvableOptions", () => {
  it("prefers the loaded option, then the known one, then a remembered pick", () => {
    const picked = new Map([
      ["a", { id: "a", label: "picked" }],
      ["b", { id: "b", label: "picked" }],
      ["c", { id: "c", label: "picked" }],
    ]);
    const map = resolvableOptions(
      [{ id: "a", label: "loaded" }],
      [
        { id: "a", label: "known" },
        { id: "b", label: "known" },
      ],
      picked,
    );
    expect(map.get("a")?.label).toBe("loaded");
    expect(map.get("b")?.label).toBe("known");
    expect(map.get("c")?.label).toBe("picked");
  });
});

describe("mergeWindowPages", () => {
  it("puts the newer window, newest first, above the older one", () => {
    const merged = mergeWindowPages(
      [
        { items: [{ id: "n1" }, { id: "n2" }], next: "2" },
        { items: [{ id: "n3" }], next: null },
      ],
      [{ items: [{ id: "o1" }, { id: "o2" }], next: null }],
    );
    expect(merged.map((item) => item.id)).toEqual([
      "n3",
      "n2",
      "n1",
      "o1",
      "o2",
    ]);
  });

  it("drops a record the two windows both returned", () => {
    expect(uniqueById([{ id: "x" }, { id: "y" }, { id: "x" }])).toEqual([
      { id: "x" },
      { id: "y" },
    ]);
  });
});
