import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * v1.4.19 — `/admin/login-overview` was rendering insights events
 * (`insights.weight-status.en`, `insights.bmi-status.en`, …) because the
 * underlying fetch never restricted the `audit-log` API to authentication
 * actions. The page subtitle promises "authentication and admin events" so
 * everything else is data we don't want to leak into the login viewer.
 *
 * The fix: the section must call the audit-log endpoint with
 * `filter=auth` whenever no explicit action filter is set. This test pins
 * the request URL so the regression cannot recur.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/login-overview",
}));

const fetchCalls: string[] = [];

vi.mock("@tanstack/react-query", async () => {
  // Implement a lightweight stub that records the URL passed to queryFn so
  // we can assert on the request the section would issue.
  return {
    useQuery: ({
      queryFn,
      enabled,
    }: {
      queryFn?: () => Promise<unknown>;
      enabled?: boolean;
    }) => {
      if (enabled !== false && queryFn) {
        // Best-effort fire-and-forget — the static-markup render only needs
        // the side-effect, not the result.
        try {
          void queryFn();
        } catch {
          /* ignored */
        }
      }
      return {
        data: {
          entries: [],
          meta: { total: 0, limit: 50, offset: 0, page: 1, perPage: 50 },
        },
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
    useMutation: () => ({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    }),
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      username: "testuser",
      email: "user@example.com",
      role: "ADMIN",
    },
    isAuthenticated: true,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { LoginOverviewSection } from "../login-overview-section";

beforeEach(() => {
  fetchCalls.length = 0;
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    fetchCalls.push(typeof url === "string" ? url : url.toString());
    return new Response(
      JSON.stringify({
        data: {
          entries: [],
          meta: { total: 0, limit: 50, offset: 0, page: 1, perPage: 50 },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LoginOverviewSection — restricts to auth events", () => {
  it("requests /api/admin/audit-log with filter=auth by default", () => {
    renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <LoginOverviewSection />
      </I18nProvider>,
    );
    const auditCalls = fetchCalls.filter((u) =>
      u.includes("/api/admin/audit-log?"),
    );
    expect(auditCalls.length).toBeGreaterThan(0);
    for (const url of auditCalls) {
      expect(url).toMatch(/[?&]filter=auth(&|$)/);
    }
  });
});
