import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import { PrivacySection } from "../privacy-section";

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: false,
      },
    },
  });
  // Seed the privacy summary so the encryption + retention blocks paint inline.
  client.setQueryData(queryKeys.privacySummary(), {
    retention: {
      coachMessagesDays: 365,
      auditLogDays: 365,
      deliveryLogDays: 90,
    },
    encryption: { algorithm: "AES-256-GCM", columnCount: 74, modelCount: 21 },
  });
  // Seed the embedded session + trusted-device + activity reads so the
  // assembled cards paint without firing network.
  client.setQueryData(queryKeys.sessions(), { sessions: [] });
  client.setQueryData(queryKeys.securityActivity(), {
    data: { events: [] },
    cap: null,
  });
  // Seed a trusted device so the card paints (it hides itself when empty).
  client.setQueryData(queryKeys.trustedDevices(), {
    devices: [
      {
        id: "td-1",
        label: "Firefox on macOS",
        isCurrent: true,
        expiresAt: "2099-01-01T00:00:00.000Z",
      },
    ],
  });
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <QueryClientProvider client={client}>{node}</QueryClientProvider>
    </I18nProvider>,
  );
}

describe("<PrivacySection> — assembled Data & Privacy dashboard", () => {
  it("renders the assembled sections (encryption, retention, delete)", () => {
    const html = render(<PrivacySection />);
    // Encryption-at-rest block driven from the seeded summary.
    expect(html).toContain("AES-256-GCM");
    // Retention numbers surfaced from the summary.
    expect(html).toContain("365");
    // The honest backup↔deletion lag disclosure is present.
    expect(html.toLowerCase()).toContain("backup");
    // Links to the destructive surface (assembly, not rebuild).
    expect(html).toContain('href="/settings/advanced"');
    // v1.44 — sessions, trusted devices and the activity feed live under
    // Security, and the duplicate export card is gone: Export & import and
    // the Health record sit beside this page in the Data group.
    expect(html).not.toContain("settings-security-sessions-card");
    expect(html).not.toContain("settings-trusted-devices-card");
    expect(html).not.toContain('href="/settings/export"');
    // ...but stay one tap away from here, where people looked for them.
    expect(html).toContain('href="/settings/security#sessions"');
  });

  it("shows a loading placeholder for the retention block before the summary resolves", () => {
    // Render WITHOUT seeding the privacy summary: the query is pending, so the
    // retention block must paint a skeleton rather than an empty list.
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false, refetchOnMount: false },
      },
    });
    client.setQueryData(queryKeys.sessions(), { sessions: [] });
    client.setQueryData(queryKeys.securityActivity(), {
      data: { events: [] },
      cap: null,
    });
    client.setQueryData(queryKeys.trustedDevices(), { devices: [] });
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <QueryClientProvider client={client}>
          <PrivacySection />
        </QueryClientProvider>
      </I18nProvider>,
    );
    // Skeleton rows render while the summary is loading; no retention day-count.
    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain("365");
  });
});
