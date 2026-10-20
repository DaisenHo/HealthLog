/**
 * The connected Dawarich card has one action row.
 *
 * The home place and home country used to sit permanently in the card body
 * with their own row of buttons (Choose home, Save) above the card's own row
 * of details, menu and primary action. The editor now opens from the menu, or
 * from a prompt while nothing is set, and only then carries its own Cancel and
 * Save.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const status = vi.hoisted(() => ({
  current: { homePlaceSet: true, homeCountry: "DE", daysStored: 12 },
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) =>
    JSON.stringify(queryKey).includes("places")
      ? { data: { places: [] }, isLoading: false, isError: false }
      : { data: status.current, isLoading: false, isError: false },
}));

let lastCardProps: IntegrationCardProps | null = null;
vi.mock("../integration-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integration-card")>();
  return {
    ...actual,
    IntegrationCard: (props: IntegrationCardProps) => {
      lastCardProps = props;
      return createElement(actual.IntegrationCard, props);
    },
  };
});

import { I18nProvider } from "@/lib/i18n/context";
import type { IntegrationCardProps } from "../integration-card";
import { DawarichCard } from "../dawarich-card";
import type { IntegrationStatusViewModel } from "../shared";
import { healthFixture } from "./health-fixture";

function render() {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <DawarichCard
        viewModel={
          {
            integration: "dawarich",
            connected: true,
            configured: true,
            health: healthFixture(),
          } as unknown as IntegrationStatusViewModel
        }
      />
    </I18nProvider>,
  );
}

function actionRows(html: string): number {
  return (
    html.match(/data-slot="(?:settings-card-actions|integration-actions)"/g) ??
    []
  ).length;
}

describe("DawarichCard", () => {
  it("has exactly one action row while the home editor is closed", () => {
    status.current = { homePlaceSet: true, homeCountry: "DE", daysStored: 12 };
    const html = render();
    expect(actionRows(html)).toBe(1);
    expect(html).toContain('data-slot="integration-actions"');
    expect(html).not.toContain('data-testid="dawarich-save-home"');
    expect(html).not.toContain('id="dawarich-home-country"');
    // Nothing to prompt for: home and country are both set.
    expect(html).not.toContain('data-testid="dawarich-pick-home"');
  });

  it("opens the home editor from the menu", () => {
    render();
    const home = lastCardProps?.menu?.find((item) => item.id === "home");
    expect(home?.onSelect).toBeTypeOf("function");
    expect(home?.label).toBe("Choose home");
  });

  it("prompts inline while the home place or country is missing", () => {
    status.current = {
      homePlaceSet: false,
      homeCountry: null as never,
      daysStored: 0,
    };
    const html = render();
    expect(html).toContain('data-testid="dawarich-pick-home"');
    expect(html).toContain('data-slot="inline-action"');
    expect(actionRows(html)).toBe(1);
  });
});
