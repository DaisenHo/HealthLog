/**
 * v1.16.11 — Bestand item-row action cluster.
 *
 * Renders `<InventorySection>` with a seeded query cache and pins the
 * per-container row contract:
 *
 *   - the adjust trigger is a visible secondary affordance
 *     (`variant="outline"`), not a bare text label;
 *   - every row carries a delete affordance behind a destructive
 *     confirm (AlertDialog trigger, 44px touch target);
 *   - the state badge sits inline on the meta line next to the
 *     dose/unit figures — a non-interactive span, never a button.
 *
 * Project convention is SSR-only component tests (`renderToStaticMarkup`).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

const useQueryMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
  useQueryClient: () => ({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { InventorySection } = await import("../sections/inventory-section");

function render(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="de">{node}</I18nProvider>,
  );
}

function seedItems(items: unknown[]) {
  useQueryMock.mockReturnValue({
    data: { items, meta: { total: items.length } },
    isLoading: false,
  });
}

describe("<InventorySection> — item-row actions", () => {
  it("renders the adjust trigger as an outline button, not a bare label", () => {
    seedItems([
      {
        id: "i1",
        state: "ACTIVE",
        containerType: "PEN",
        unitsTotal: 4,
        unitsRemaining: 4,
      },
    ]);
    const html = render(
      <InventorySection medicationId="med-1" unitsPerDose={1} />,
    );
    const adjust = html.match(
      /<button[^>]*data-slot="inventory-adjust-button"[^>]*>/,
    );
    expect(adjust).not.toBeNull();
    expect(adjust![0]).toContain('data-variant="outline"');
  });

  it("renders a per-row delete affordance behind a confirm trigger", () => {
    seedItems([
      {
        id: "i1",
        state: "ACTIVE",
        containerType: "PEN",
        unitsTotal: 4,
        unitsRemaining: 4,
      },
      {
        id: "i2",
        state: "IN_USE",
        containerType: "PEN",
        unitsTotal: 4,
        unitsRemaining: 2,
      },
    ]);
    const html = render(
      <InventorySection medicationId="med-1" unitsPerDose={1} />,
    );
    // One AlertDialog trigger per row, labelled with the shared delete copy.
    const triggers = html.match(/aria-label="Löschen"/g) ?? [];
    expect(triggers).toHaveLength(2);
    expect(html).toContain("alert-dialog-trigger");
  });

  it("places the state badge inline on the meta line as a non-interactive span", () => {
    seedItems([
      {
        id: "i1",
        state: "ACTIVE",
        containerType: "PEN",
        unitsTotal: 4,
        unitsRemaining: 4,
      },
    ]);
    const html = render(
      <InventorySection medicationId="med-1" unitsPerDose={1} />,
    );
    const badge = html.match(
      /<(\w+)[^>]*data-slot="inventory-state-badge"[^>]*>/,
    );
    expect(badge).not.toBeNull();
    expect(badge![1]).toBe("span");
    expect(badge![0]).toContain("text-xs");
    // The badge renders before the action cluster — inline with the
    // meta figures, not floated next to the buttons.
    const badgeIdx = html.indexOf('data-slot="inventory-state-badge"');
    const dosesIdx = html.indexOf("4 / 4 Dosen");
    const adjustIdx = html.indexOf('data-slot="inventory-adjust-button"');
    expect(dosesIdx).toBeGreaterThan(-1);
    expect(badgeIdx).toBeGreaterThan(dosesIdx);
    expect(badgeIdx).toBeLessThan(adjustIdx);
  });
});
