/**
 * v1.17 — picker-side management-suite additions:
 *   - a custom tag renders its decrypted `label` (the v1.13 API field
 *     the web picker previously ignored — the raw `custom:<uuid>` key
 *     used to paint through the `t()` fallback);
 *   - every group carries a trailing ghost "+" tile that opens the
 *     inline create sheet, plus a synthetic Custom bootstrap group when
 *     the plain read carries no custom node yet;
 *   - render order is exactly the server-resolved order (no client
 *     sorting).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

interface FixtureCatalog {
  categories: unknown[];
}

const queryState: { catalog: FixtureCatalog | null } = { catalog: null };

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => {
    if (
      Array.isArray(queryKey) &&
      queryKey[0] === "mood-tag-catalog" &&
      queryKey.length === 1
    ) {
      return { data: queryState.catalog, isLoading: false };
    }
    return { data: null, isLoading: false };
  },
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    getQueryData: vi.fn(),
    cancelQueries: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/use-is-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { MoodTagPicker } from "../mood-tag-picker";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

const CATALOG = {
  categories: [
    {
      key: "feelings",
      labelKey: "mood.tagCategory.feelings",
      label: null,
      icon: "Smile",
      custom: false,
      tags: [
        {
          key: "happy",
          labelKey: "mood.tag.happy",
          label: null,
          icon: "Smile",
          kind: "BINARY",
          scaleMin: 0,
          scaleMax: 1,
          inverse: false,
          custom: false,
        },
      ],
    },
    {
      key: "custom",
      labelKey: "mood.tagCategory.custom",
      label: null,
      icon: "SlidersHorizontal",
      custom: false,
      tags: [
        {
          key: "custom:11111111-aaaa",
          labelKey: "custom:11111111-aaaa",
          label: "Gartenarbeit",
          icon: "Leaf",
          kind: "BINARY",
          scaleMin: 0,
          scaleMax: 1,
          inverse: false,
          custom: true,
        },
      ],
    },
  ],
};

function render(locale: "en" | "de" = "de"): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <MoodTagPicker selected={[]} onToggle={() => {}} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  queryState.catalog = CATALOG;
});

describe("<MoodTagPicker> — custom labels + inline create", () => {
  it("renders a custom tag by its decrypted label, never the raw key", () => {
    const html = render();
    expect(html).toContain("Gartenarbeit");
    expect(html).not.toContain("custom:11111111-aaaa</span>");
  });

  it("keeps resolving catalogue tags through their i18n key", () => {
    const html = render("en");
    expect(html).toContain("happy");
    expect(html).not.toContain("mood.tag.happy");
  });

  it("renders a trailing + tile per group with the localised aria-label", () => {
    const html = render();
    const tiles = html.match(/data-slot="mood-tag-add-tile"/g);
    expect(tiles?.length ?? 0).toBe(2); // one per group
    expect(html).toContain("Tag hinzufügen");
  });

  it("synthesizes the Custom bootstrap group when the plain read has no custom node", () => {
    queryState.catalog = { categories: [CATALOG.categories[0]] };
    const html = render();
    expect(html).toContain('data-slot="mood-tag-custom-bootstrap"');
    expect(html).toContain("Eigene"); // mood.tagCategory.custom (de)
  });

  it("does NOT synthesize the bootstrap group when the custom node exists", () => {
    const html = render();
    expect(html).not.toContain('data-slot="mood-tag-custom-bootstrap"');
  });

  it("renders groups and tags in exactly the server order", () => {
    const html = render();
    expect(html.indexOf("Feelings") === -1).toBe(true); // de locale
    const feelings = html.indexOf("Gefühle");
    const custom = html.indexOf("Gartenarbeit");
    expect(feelings).toBeGreaterThanOrEqual(0);
    expect(custom).toBeGreaterThan(feelings);
  });
});
