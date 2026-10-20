import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import type { DataSummary } from "@/lib/analytics/trends";

/**
 * The recovery page's empty note says what is missing for THIS account, and
 * the reason is the server's (`recoveryEmpty` on the analytics slice): the
 * page only picks the sentence for it and never reads the connection status
 * itself. Every reason offers the same way on, the integrations settings.
 */

vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = () => <div data-slot="mini-chart-stub" />;
    Stub.displayName = "MiniChartStub";
    return Stub;
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { timezone: "UTC" }, isAuthenticated: true }),
}));

const analyticsMock = vi.fn();
vi.mock("@/hooks/use-insights-analytics", () => ({
  useInsightsAnalytics: () => analyticsMock(),
}));

import { RecoverySection } from "../recovery/recovery-section";

function summary(count: number): DataSummary {
  return {
    count,
    latest: null,
    min: null,
    max: null,
    mean: null,
    median: null,
    avg7: null,
    avg30: null,
    slope7: null,
    slope30: null,
    anomalyCount: 0,
  };
}

/** An Oura-only account: readiness, HRV and sleep, no recovery type. */
const OURA_SUMMARIES = {
  SLEEP_DURATION: summary(30),
  RECOVERY_SCORE: summary(30),
  HRV_RMSSD: summary(30),
};

function render(recoveryEmpty: string | null, error: unknown = null) {
  analyticsMock.mockReturnValue({
    data: error ? undefined : { summaries: OURA_SUMMARIES, recoveryEmpty },
    isLoading: false,
    isEmpty: false,
    error,
    refetch: () => {},
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en">
        <RecoverySection />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  analyticsMock.mockReset();
});

describe("<RecoverySection> empty note", () => {
  it.each([
    ["oura_permission", "heart-health access"],
    ["general", "WHOOP or Polar"],
  ])("renders the server's %s reason with the one action", (reason, text) => {
    const html = render(reason);
    expect(html).toContain(`data-empty-case="${reason}"`);
    expect(html).toContain(text);
    expect(html).toContain('href="/settings/integrations"');
  });

  it("offers nothing to open while Oura's first level is on its way", () => {
    // The connection is fine; there is nothing under Integrations to do.
    const html = render("oura_no_resilience");
    expect(html).toContain('data-empty-case="oura_no_resilience"');
    expect(html).toContain("as soon as Oura provides one");
    expect(html).not.toContain('href="/settings/integrations"');
  });

  it("says a failed read instead of a skeleton that never ends", () => {
    const html = render(null, new Error("boom"));
    expect(html).toContain('data-slot="query-error-card"');
    expect(html).not.toContain('data-slot="recovery-loading"');
  });

  it("shows no note when the server says the page has data", () => {
    const html = render(null);
    expect(html).not.toContain("data-empty-case");
  });
});
