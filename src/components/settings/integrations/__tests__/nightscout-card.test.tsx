/**
 * Nightscout on the shared integration card.
 *
 *   1. A paused connection offers "Resume", which opens the address form (there
 *      is no OAuth round-trip to re-run).
 *   2. A healthy connection keeps sync, test, the data link and disconnect in
 *      the menu, and disconnect asks first.
 *   3. The card reads the consolidated envelope, so a disconnect invalidates
 *      that one key.
 *   4. An unapproved private origin is named for what it is, an operator
 *      action, without echoing the stored error text.
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { queryKeys } from "@/lib/query-keys";

const invalidateSpy = vi.fn();
const capturedDisconnectOnSuccess: { fn: (() => void) | null } = { fn: null };

vi.mock("@tanstack/react-query", () => ({
  useMutation: ({ onSuccess }: { onSuccess?: () => void }) => {
    // The Nightscout card declares exactly one mutation (disconnect).
    capturedDisconnectOnSuccess.fn = onSuccess ?? null;
    return { mutate: vi.fn(), isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: invalidateSpy }),
}));

let lastCardProps: IntegrationCardProps | null = null;
vi.mock("../integration-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../integration-card")>();
  return {
    ...actual,
    IntegrationCard: (props: IntegrationCardProps) => {
      lastCardProps = props;
      return createElement(actual.IntegrationCard, props);
    },
  };
});

import { I18nProvider } from "@/lib/i18n/context";
import type { IntegrationCardProps } from "../integration-card";
import { NightscoutCard } from "../nightscout-card";
import type { IntegrationStatusViewModel } from "../shared";
import { healthFixture } from "./health-fixture";

/** The envelope carries more than the card declares; the card must ignore it. */
type Envelope = Partial<IntegrationStatusViewModel> & {
  lastError?: string | null;
};

function render(viewModel?: Envelope) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <NightscoutCard
        viewModel={
          viewModel
            ? ({
                integration: "nightscout",
                lastError: null,
                ...viewModel,
              } as IntegrationStatusViewModel)
            : undefined
        }
      />
    </I18nProvider>,
  );
}

function menuIds(): string[] {
  return (lastCardProps?.menu ?? []).map((item) => item.id);
}

describe("NightscoutCard on the shared card", () => {
  it("offers Resume on a paused connection, and Resume opens the address form", () => {
    const html = render({
      connected: true,
      configured: true,
      health: healthFixture({
        state: "action_required",
        reason: "paused_after_errors",
        since: "2026-10-12T14:00:00.000Z",
        action: "resume",
      }),
    });
    expect(html).toMatch(
      /data-slot="integration-health-badge"[^>]*data-state="action_required"/,
    );
    expect(html).toContain('data-action="resume"');
    expect(html).toContain("Nightscout is paused after failing since");
    expect(lastCardProps?.primary?.onResume).toBeTypeOf("function");
    // The form is closed until the button asks for it.
    expect(html).not.toContain('id="nightscout-url"');
  });

  it("keeps sync, test, the data link and disconnect in the menu", () => {
    render({
      connected: true,
      configured: true,
      health: healthFixture(),
      metricFreshness: [],
    });
    expect(menuIds()).toEqual([
      "sync",
      "test",
      "view-data",
      "credentials",
      "setup-guide",
      "disconnect",
    ]);
    const viewData = lastCardProps?.menu?.find((i) => i.id === "view-data");
    expect(viewData?.href).toBe("/insights/blood-glucose");
    const disconnect = lastCardProps?.menu?.find((i) => i.id === "disconnect");
    expect(disconnect?.destructive).toBe(true);
    expect(disconnect?.confirm?.title).toBeTruthy();
  });

  it("puts the per-metric list in the details, stale rows included", () => {
    const html = render({
      connected: true,
      configured: true,
      health: healthFixture(),
      metricFreshness: [
        {
          type: "BLOOD_GLUCOSE",
          lastSeenAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          stale: true,
        },
      ],
    });
    const details = html.slice(html.indexOf('data-slot="integration-details"'));
    expect(details).toContain('data-metric="BLOOD_GLUCOSE"');
    expect(details).toContain('data-state="stale"');
  });

  it("disconnect invalidates the envelope the card actually reads", () => {
    render({ connected: true, configured: true, health: healthFixture() });
    invalidateSpy.mockClear();
    capturedDisconnectOnSuccess.fn?.();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.integrationsStatus(),
    });
  });

  it("shows the address form and Connect while not connected", () => {
    const html = render({ connected: false, configured: false, health: null });
    expect(html).toContain('data-state="not_connected"');
    expect(html).toContain('id="nightscout-url"');
    expect(html).toContain('data-testid="nightscout-connect"');
    expect(html).toContain('data-testid="nightscout-setup-guide"');
  });
});

describe("NightscoutCard — operator-owned private access", () => {
  it("does not offer an ordinary user a private-host enforcement bypass", () => {
    const html = render({ connected: false, configured: false, health: null });

    expect(html).not.toContain('id="nightscout-private"');
    expect(html).not.toContain("This site runs on a private network");
    expect(html).not.toContain("Enable only if your Nightscout instance");
  });

  it("names the operator action for an unapproved private origin without echoing the error", () => {
    const html = render({
      connected: true,
      configured: true,
      // Still on the wire for one release; the card must not show it.
      lastError:
        "private_origin_not_approved: http://10.0.0.4:1337/api/v1/entries.json?token=ns-secret",
      health: healthFixture({
        state: "degraded",
        reason: "provider_errors",
        since: "2026-10-14T18:40:00.000Z",
        diagnostics: {
          ledgerState: "error_transient",
          failingLegs: ["sync"],
          failingSince: "2026-10-14T18:40:00.000Z",
          lastAttemptAt: "2026-10-15T09:15:00.000Z",
          verdict: "failing",
          recentCalls: [
            {
              endpoint: "sync",
              status: "persistent",
              at: "2026-10-15T09:15:00.000Z",
              errorCode: "private_origin_not_approved",
            },
          ],
        },
      }),
    });

    expect(html).toContain(
      'data-testid="nightscout-private-operator-required"',
    );
    expect(html).toContain(
      "Private Nightscout access requires server operator approval.",
    );
    // The short code appears in the diagnostics block, the stored message
    // nowhere: no address, no token.
    expect(html).not.toContain("private_origin_not_approved:");
    expect(html).not.toContain("10.0.0.4");
    expect(html).not.toContain("ns-secret");
    // Sync and test cannot help until the operator approves the origin.
    expect(menuIds()).not.toContain("sync");
    expect(menuIds()).not.toContain("test");
    expect(menuIds()).toContain("disconnect");
  });

  it("keeps a healthy connection usable", () => {
    const html = render({
      connected: true,
      configured: true,
      lastError: null,
      health: healthFixture(),
    });

    expect(menuIds()).toContain("sync");
    expect(menuIds()).toContain("test");
    expect(html).not.toContain(
      'data-testid="nightscout-private-operator-required"',
    );
  });
});
