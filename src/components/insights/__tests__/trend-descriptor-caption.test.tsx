import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";

/**
 * v1.11.4 item J — `<TrendDescriptorCaption>` is the deterministic
 * fallback the Trends row shows when the AI advisor produced no
 * annotation (cold briefing). It reads the SAME series the mini-chart
 * plots and renders a neutral direction + magnitude descriptor, or the
 * real "Awaiting more data" hint only when the series is genuinely too
 * sparse.
 *
 * The component reads its series through `useQuery`. We pre-seed the
 * QueryClient cache (matching the factory keys) with `staleTime:
 * Infinity` so the SSR render resolves synchronously off the cache, and
 * stub `useAuth` authenticated so the query is enabled.
 */

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

import { TrendDescriptorCaption } from "../trend-annotation";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

function seededClient(seed: (client: QueryClient) => void): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  seed(client);
  return client;
}

function render(
  client: QueryClient,
  node: React.ReactNode,
  locale: "en" | "de" = "en",
) {
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale={locale}>{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

function numericSeries(values: number[]): {
  value: number;
  measuredAt: string;
}[] {
  return values.map((value, i) => ({
    value,
    measuredAt: new Date(Date.UTC(2026, 0, 1 + i, 12)).toISOString(),
  }));
}

describe("<TrendDescriptorCaption>", () => {
  it("renders a rising numeric descriptor with the signed magnitude + unit", () => {
    const client = seededClient((c) =>
      c.setQueryData(queryKeys.insightsTrendSeries("BLOOD_PRESSURE_SYS"), [
        ...numericSeries([120, 124, 128]).map((r) => ({
          value: r.value,
          measuredAt: r.measuredAt,
        })),
      ]),
    );
    const html = render(
      client,
      <TrendDescriptorCaption
        metric="bp"
        emptyMetric="bp"
        kind="numeric"
        types={["BLOOD_PRESSURE_SYS", "BLOOD_PRESSURE_DIA"]}
      />,
    );
    expect(html).toMatch(/data-slot="trend-annotation-descriptor"/);
    expect(html).toMatch(/data-metric="bp"/);
    expect(html).toContain("Rising over 30 days");
    expect(html).toContain("+8 mmHg");
    // Observational + neutral — no causal / medical framing leaks in.
    expect(html).not.toContain("Awaiting more data");
  });

  it("renders a falling weight descriptor", () => {
    const client = seededClient((c) =>
      c.setQueryData(
        queryKeys.insightsTrendSeries("WEIGHT"),
        numericSeries([82.4, 81.5, 81.0]),
      ),
    );
    const html = render(
      client,
      <TrendDescriptorCaption
        metric="weight"
        emptyMetric="weight"
        kind="numeric"
        types={["WEIGHT"]}
      />,
    );
    expect(html).toContain("Falling over 30 days");
    expect(html).toContain("−1.4 kg");
  });

  it("renders a stable descriptor when the move is within the metric floor", () => {
    const client = seededClient((c) =>
      c.setQueryData(
        queryKeys.insightsTrendSeries("WEIGHT"),
        numericSeries([81.0, 81.1]),
      ),
    );
    const html = render(
      client,
      <TrendDescriptorCaption
        metric="weight"
        emptyMetric="weight"
        kind="numeric"
        types={["WEIGHT"]}
      />,
    );
    expect(html).toContain("Stable over the last 30 days");
  });

  it("renders the mood descriptor in plain improved/declined terms (no raw delta)", () => {
    // Mood analytics returns the full history; the descriptor filters to
    // the trailing 30-day window client-side, so seed two recent days.
    const dayKey = (daysAgo: number): string =>
      new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
    const client = seededClient((c) =>
      c.setQueryData(queryKeys.moodAnalytics(), {
        entries: [
          { date: dayKey(20), score: 3 },
          { date: dayKey(2), score: 4 },
        ],
      }),
    );
    const html = render(
      client,
      <TrendDescriptorCaption
        metric="mood"
        emptyMetric="mood"
        kind="mood"
        types={[]}
      />,
    );
    expect(html).toMatch(/data-slot="trend-annotation-descriptor"/);
    expect(html).toContain("Mood trended slightly higher over 30 days");
    // Categorical scale — no raw numeric point delta in the copy.
    expect(html).not.toMatch(/\+\d/);
  });

  it("falls back to the real empty hint when the series is too sparse", () => {
    const client = seededClient((c) =>
      c.setQueryData(
        queryKeys.insightsTrendSeries("WEIGHT"),
        numericSeries([81.0]),
      ),
    );
    const html = render(
      client,
      <TrendDescriptorCaption
        metric="weight"
        emptyMetric="weight"
        kind="numeric"
        types={["WEIGHT"]}
      />,
    );
    expect(html).toMatch(/data-slot="trend-annotation-empty"/);
    expect(html).toContain("Awaiting more data");
  });

  it("localises the descriptor (German)", () => {
    const client = seededClient((c) =>
      c.setQueryData(
        queryKeys.insightsTrendSeries("BLOOD_PRESSURE_SYS"),
        numericSeries([120, 128]),
      ),
    );
    const html = render(
      client,
      <TrendDescriptorCaption
        metric="bp"
        emptyMetric="bp"
        kind="numeric"
        types={["BLOOD_PRESSURE_SYS"]}
      />,
      "de",
    );
    expect(html).toContain("steigend");
    expect(html).toContain("+8 mmHg");
  });
});
