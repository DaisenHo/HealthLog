/**
 * v1.30 — the ECG row in the Insights sub-page manager.
 *
 * ECG has no `MeasurementType` and therefore no sub-page tile; its overview
 * presence is the `"ecg"` SECTION. The manager surfaces it as a Heart-group
 * row so hiding the ECG surface is reversible from the same place. The eye
 * reflects (and toggles) the `"ecg"` section's `visible` flag.
 *
 * SSR-only suite per project convention: static markup pins the rendered eye
 * state.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import {
  DEFAULT_INSIGHTS_LAYOUT,
  type InsightsLayout,
} from "@/lib/insights-layout";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null, isAuthenticated: true }),
}));

const layoutSpy = vi.fn<
  () => { layout: InsightsLayout; isLoading: boolean; isSuccess: boolean }
>(() => ({
  layout: DEFAULT_INSIGHTS_LAYOUT,
  isLoading: false,
  isSuccess: true,
}));
vi.mock("@/hooks/use-insights-layout", () => ({
  useInsightsLayoutQuery: () => layoutSpy(),
}));

import { InsightsPillOrderSection } from "../insights-pill-order-section";

function layoutWithEcgVisible(visible: boolean): InsightsLayout {
  return {
    version: DEFAULT_INSIGHTS_LAYOUT.version,
    sections: DEFAULT_INSIGHTS_LAYOUT.sections.map((s) =>
      s.id === "ecg" ? { ...s, visible } : { ...s },
    ),
    tiles: DEFAULT_INSIGHTS_LAYOUT.tiles.map((t) => ({ ...t })),
  };
}

beforeEach(() => {
  layoutSpy.mockImplementation(() => ({
    layout: DEFAULT_INSIGHTS_LAYOUT,
    isLoading: false,
    isSuccess: true,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

function render(): string {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <InsightsPillOrderSection id="insights-pill-order" />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("<InsightsPillOrderSection> — ECG row (H1)", () => {
  it("lists an ECG row inside the Heart group", () => {
    const html = render();
    // The ECG row rides the Heart group and carries an eye toggle.
    expect(html).toContain('data-group="heart"');
    expect(html).toMatch(
      /data-tile="ecg"[\s\S]*?data-slot="insights-pill-order-eye"/,
    );
  });

  it("reflects the ECG section visible (default layout)", () => {
    const html = render();
    const ecgRow = html.match(
      /<div[^>]*data-tile="ecg"[\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(ecgRow).not.toBeNull();
    expect(ecgRow![0]).toContain('data-visible="true"');
  });

  it("reflects a hidden ECG section from the saved layout", () => {
    layoutSpy.mockImplementation(() => ({
      layout: layoutWithEcgVisible(false),
      isLoading: false,
      isSuccess: true,
    }));
    const html = render();
    const ecgRow = html.match(
      /<div[^>]*data-tile="ecg"[\s\S]*?<\/div>\s*<\/div>/,
    );
    expect(ecgRow).not.toBeNull();
    expect(ecgRow![0]).toContain('data-visible="false"');
  });
});
