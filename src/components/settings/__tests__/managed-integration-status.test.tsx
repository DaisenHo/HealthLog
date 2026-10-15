/**
 * A managed record's connections on the shared integration card, read-only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { ConnectionHealth } from "@/lib/integrations/connection-health";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "guardian",
      accountAccess: {
        active: {
          accountId: "record-1",
          recordKind: "managed",
          displayName: "Managed record",
        },
      },
    },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

let payload: unknown;
let loading = false;
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: payload,
    isLoading: loading,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { ManagedIntegrationStatus } from "../managed-integration-status";
import { healthFixture } from "../integrations/__tests__/health-fixture";

const KEYS = [
  "withings",
  "whoop",
  "fitbit",
  "nightscout",
  "polar",
  "oura",
  "google-health",
  "strava",
];

function render() {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <ManagedIntegrationStatus />
    </I18nProvider>,
  );
}

function withHealth(map: Record<string, ConnectionHealth | null>) {
  return {
    recordId: "record-1",
    integrations: KEYS.map((integration) => ({
      integration,
      // The legacy fields still ride the wire; the view must not use them.
      state: "connected",
      lastSuccessAt: null,
      lastAttemptAt: null,
      health: map[integration] ?? null,
    })),
  };
}

describe("<ManagedIntegrationStatus>", () => {
  beforeEach(() => {
    payload = undefined;
    loading = false;
  });

  it("renders one shared card per provider from health, with no control on any", () => {
    payload = withHealth({
      oura: healthFixture({
        state: "action_required",
        reason: "reauth_required",
        action: "reconnect",
      }),
      withings: healthFixture(),
    });
    const html = render();

    expect(html).toContain('data-record-settings-family="integrations"');
    expect(html).toContain(
      'aria-labelledby="managed-integration-status-title"',
    );
    expect(html).toContain('data-record-id="record-1"');
    expect(html.match(/data-slot="integration-card"/g)).toHaveLength(8);
    for (const key of KEYS) {
      expect(html).toContain(`data-testid="managed-integration-${key}"`);
    }
    expect(html).toMatch(
      /data-testid="managed-integration-oura"[\s\S]*?data-slot="integration-health-badge"[^>]*data-state="action_required"/,
    );
    // Read-only even where the state asks for an action.
    expect(html).not.toContain('data-slot="integration-primary-action"');
    expect(html).not.toContain('data-slot="integration-menu-trigger"');
    // The legacy `state: "connected"` on every row does not make a card
    // connected; only `health` does.
    expect(html.match(/>Not connected\.</g)).toHaveLength(6);
  });

  it("says once why nothing here can be changed, and links the explanation", () => {
    payload = withHealth({});
    const html = render();
    expect(html).toContain('data-slot="managed-integration-read-only"');
    expect(html).toContain(
      "A managed profile shows its connected services as a status only.",
    );
    expect(html).toContain(
      'href="https://docs.healthlog.dev/self-hosting/account-sharing#records-with-no-login"',
    );
  });

  it("paints the cards while loading without claiming a state", () => {
    loading = true;
    const html = render();
    expect(html).toContain('aria-busy="true"');
    expect(html).not.toContain(
      'aria-labelledby="managed-integration-status-title"',
    );
    expect(html).not.toContain('data-slot="integration-health-badge"');
    expect(html).not.toContain("Not connected.");
  });
});
