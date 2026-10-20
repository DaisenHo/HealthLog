import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";

/**
 * v1.30 — `<EcgCrossLink>` now mounts on the resting-pulse
 * and HRV sub-pages (previously only on `/insights/pulse`), threaded through
 * `<HealthKitMetricPage afterAssessment>`. The pointer self-gates on
 * recordings, so the shared `insightsEcgList` cache is pre-seeded with one
 * recording to exercise the mounted path.
 */

vi.mock("next/dynamic", () => ({
  default: () => {
    const Stub = () => <div data-slot="healthkit-chart-stub" />;
    Stub.displayName = "HealthChartStub";
    return Stub;
  },
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { timezone: "UTC", dateOfBirth: null, gender: null },
    isAuthenticated: true,
  }),
}));

vi.mock("@/hooks/use-insights-layout-prefs", () => ({
  useInsightsLayoutPrefs: () => ({ layout: null, compareBaseline: false }),
}));

const analyticsMock = vi.fn();
vi.mock("@/hooks/use-insights-analytics", () => ({
  useInsightsAnalytics: () => analyticsMock(),
}));

const metricStatusMock = vi.fn();
vi.mock("@/hooks/use-insight-status", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-insight-status")>();
  return {
    ...actual,
    useInsightMetricStatus: (...args: unknown[]) => metricStatusMock(...args),
  };
});

import RestingPulsePage from "@/app/insights/resting-pulse/page";
import HrvPage from "@/app/insights/hrv/page";

function render(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  // Seed the ECG list the cross-link reads so its data-availability gate opens.
  client.setQueryData(queryKeys.insightsEcgList(), {
    data: {
      recordings: [{ id: "a", classification: null }],
      hasRecordings: true,
    },
    cap: null,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  analyticsMock.mockReset();
  metricStatusMock.mockReset();
  // Data-bearing branch for both metric pages.
  analyticsMock.mockReturnValue({
    data: {
      summaries: {
        RESTING_HEART_RATE: { count: 5 },
        HEART_RATE_VARIABILITY: { count: 5 },
      },
    },
    isEmpty: false,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  metricStatusMock.mockReturnValue({ data: undefined, isLoading: false });
});

describe("EcgCrossLink mount on Heart sub-pages (H1)", () => {
  it("mounts the ECG cross-link on the resting-pulse page", () => {
    const html = render(<RestingPulsePage />);
    expect(html).toContain('data-slot="ecg-cross-link"');
    expect(html).toContain('href="/insights/ecg"');
  });

  it("mounts the ECG cross-link on the HRV page", () => {
    const html = render(<HrvPage />);
    expect(html).toContain('data-slot="ecg-cross-link"');
    expect(html).toContain('href="/insights/ecg"');
  });
});
