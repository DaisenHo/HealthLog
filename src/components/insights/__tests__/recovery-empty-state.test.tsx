import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import type { DataSummary } from "@/lib/analytics/trends";

/**
 * The recovery page's empty note says what is missing for THIS account. An
 * Oura ring fills the page through its resilience level alone, so a connected
 * ring with an empty page asks for a reconnect only when the server recorded
 * that the grant leaves resilience out, and otherwise says only that no
 * level has arrived. The connection facts come from the server's
 * integrations read; the page only picks the sentence, and waits for it.
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

function render(
  oura: Record<string, unknown> | null,
  opts: { statusLoaded?: boolean } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (opts.statusLoaded !== false) {
    queryClient.setQueryData(queryKeys.integrationsStatus(), {
      threshold: 3,
      integrations: oura ? [{ integration: "oura", ...oura }] : [],
    });
  }
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

  it("says only that no level has arrived when no withheld permission is recorded", () => {
    const html = render({
      connected: true,
      health: health([{ item: "spo2", cause: "permission" }]),
    });
    expect(html).toContain('data-empty-case="oura-no-resilience"');
    expect(html).toContain("no resilience level has arrived");
    // The server cannot prove the grant covers resilience, so the note
    // never says it does.
    expect(html).not.toContain("permission covers");
    expect(html).not.toContain('href="/settings/integrations"');
  });

  it("stays neutral when the connection carries no health block", () => {
    const html = render({ connected: true });
    expect(html).toContain('data-empty-case="oura-no-resilience"');
    expect(html).not.toContain("permission covers");
  });

  it("shows no note until the connection status has loaded", () => {
    const html = render(
      { connected: true, health: health([]) },
      { statusLoaded: false },
    );
    expect(html).toContain('data-slot="recovery-loading"');
    expect(html).not.toContain("data-empty-case");
  });

  it("keeps the general note for an account without Oura", () => {
    const html = render(null);
    expect(html).toContain('data-empty-case="general"');
    expect(html).toContain("WHOOP and Polar record");
  });
});
