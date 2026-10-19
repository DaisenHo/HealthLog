import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import type { DataSummary } from "@/lib/analytics/trends";

/**
 * The recovery page's empty note says what is missing for THIS account. An
 * Oura ring fills the page through its resilience level alone, so a connected
 * ring with an empty page is either a grant that leaves out the heart-health
 * data the level sits behind, or Oura not having sent a level yet. The
 * connection facts come from the server's integrations read; the page only
 * picks the sentence.
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

/** An Oura-only account: readiness, HRV and sleep, no resilience level. */
const OURA_SUMMARIES = {
  SLEEP_DURATION: summary(30),
  RECOVERY_SCORE: summary(30),
  HRV_RMSSD: summary(30),
};

function render(oura: Record<string, unknown> | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.integrationsStatus(), {
    threshold: 3,
    integrations: oura ? [{ integration: "oura", ...oura }] : [],
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en">
        <RecoverySection />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

function health(unavailable: Array<{ item: string; cause: string }>) {
  return {
    state: unavailable.length > 0 ? "limited" : "ok",
    reason: unavailable.length > 0 ? "permission_limited" : "data_arriving",
    unavailable,
  };
}

beforeEach(() => {
  analyticsMock.mockReset();
  analyticsMock.mockReturnValue({
    data: { summaries: OURA_SUMMARIES },
    isLoading: false,
    isEmpty: false,
    error: null,
    refetch: () => {},
  });
});

describe("<RecoverySection> empty note", () => {
  it("asks for the heart-health permission when the grant withholds resilience", () => {
    const html = render({
      connected: true,
      health: health([{ item: "resilience", cause: "permission" }]),
    });
    expect(html).toContain('data-empty-case="oura-permission"');
    expect(html).toContain("allow heart-health access");
    expect(html).toContain('href="/settings/integrations"');
  });

  it("says Oura has sent no level yet when the grant covers it", () => {
    const html = render({
      connected: true,
      health: health([{ item: "spo2", cause: "permission" }]),
    });
    expect(html).toContain('data-empty-case="oura-no-resilience"');
    expect(html).toContain("has not sent a resilience level");
    expect(html).not.toContain('href="/settings/integrations"');
  });

  it("keeps the general note for an account without Oura", () => {
    const html = render(null);
    expect(html).toContain('data-empty-case="general"');
    expect(html).toContain("WHOOP and Polar record");
  });
});
