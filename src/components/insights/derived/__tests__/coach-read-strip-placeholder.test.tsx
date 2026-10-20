import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import { ApiError } from "@/lib/api/api-fetch";
import { queryKeys } from "@/lib/query-keys";

/**
 * The strip sits above the chart on every metric sub-page. While its read is
 * on the way it holds its place with a card of the same anatomy, so the chart
 * and everything below it do not jump down when the read lands.
 */

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { timezone: "UTC", dateOfBirth: null, gender: null },
    isAuthenticated: true,
  }),
}));

vi.mock("@/hooks/use-mounted", () => ({ useMounted: () => true }));

import { CoachReadStrip } from "../coach-read-strip";

describe("CoachReadStrip — placeholder while the read loads", () => {
  it("paints the card frame and title before the read lands", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, enabled: false } },
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale="en">
          <CoachReadStrip metricType="WEIGHT" unit="kg" />
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(markup).toContain('data-slot="coach-read-strip"');
    expect(markup).toContain('data-state="loading"');
    expect(markup).toContain('aria-busy="true"');
  });

  function renderFailed(error: unknown) {
    // `retryOnMount: false` keeps the seeded failure from being reset to a
    // fresh load on render.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, enabled: false, retryOnMount: false },
      },
    });
    client
      .getQueryCache()
      .build(client, { queryKey: queryKeys.insightsCoachRead("WEIGHT", "en") })
      .setState({ status: "error", error, fetchStatus: "idle" });
    return renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <I18nProvider initialLocale="en">
          <CoachReadStrip metricType="WEIGHT" unit="kg" />
        </I18nProvider>
      </QueryClientProvider>,
    );
  }

  /** The class list of the strip body, the element after the header. */
  function bodyClass(markup: string): string | undefined {
    return /data-slot="card-content" class="([^"]*)"/.exec(markup)?.[1];
  }

  it("holds the same frame and body height when the read fails", () => {
    const loading = renderToStaticMarkup(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, enabled: false } },
          })
        }
      >
        <I18nProvider initialLocale="en">
          <CoachReadStrip metricType="WEIGHT" unit="kg" />
        </I18nProvider>
      </QueryClientProvider>,
    );
    const failed = renderFailed(new ApiError("Boom", 500));
    expect(failed).toContain('data-slot="coach-read-strip"');
    expect(failed).toContain('data-state="error"');
    expect(failed).toContain('data-slot="coach-read-strip-error"');
    expect(bodyClass(failed)).toBeDefined();
    expect(bodyClass(failed)).toBe(bodyClass(loading));
    expect(bodyClass(failed)).toContain("min-h-8");
  });

  it("draws nothing for a refused read", () => {
    expect(renderFailed(new ApiError("Forbidden", 403))).toBe("");
  });
});
