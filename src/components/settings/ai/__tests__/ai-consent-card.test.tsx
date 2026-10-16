import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AiConsentState } from "@/lib/ai/capabilities/types";
import { I18nProvider } from "@/lib/i18n/context";

/**
 * The standing AI consent in Settings → AI, rendered from `ai.consent` on
 * `/api/auth/me`. What these pin: the card says since when and to which
 * service consent was given and offers the withdrawal only then; it never
 * offers a grant of its own (the question lives in `AiConsentRequest`, at
 * the top of the page, and only there); and it never misreports a decision it
 * has not been told.
 */

const consentState = vi.hoisted(() => ({
  value: null as AiConsentState | null,
  authLoading: false,
}));

vi.mock("@/hooks/use-ai-capability", () => ({
  useAiConsent: () => consentState.value,
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ isLoading: consentState.authLoading }),
}));

import { AiConsentCard } from "../ai-consent-card";

function render(isAuthenticated = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <AiConsentCard isAuthenticated={isAuthenticated} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  consentState.value = null;
  consentState.authLoading = false;
});

describe("AiConsentCard", () => {
  it("says since when and to which service consent was given, with the withdrawal", () => {
    consentState.value = {
      status: "given",
      since: "2026-07-01T08:00:00.000Z",
      recipients: [{ via: "operator_key", name: "OpenAI" }],
    };
    const html = render();

    expect(html).toContain('data-slot="ai-consent-withdraw"');
    expect(html).toContain("Withdraw consent");
    expect(html).toContain("Given on");
    expect(html).toContain("OpenAI");
  });

  it("falls back to the configured provider when no operator service is in the chain", () => {
    consentState.value = {
      status: "given",
      since: "2026-07-01T08:00:00.000Z",
      recipients: [],
    };
    const html = render();
    expect(html).toContain("the configured provider");
    expect(html).toContain('data-slot="ai-consent-withdraw"');
  });

  it.each(["needed", "not_needed"] as const)(
    "offers no withdrawal and no grant of its own while consent is %s",
    (status) => {
      consentState.value = {
        status,
        since: null,
        recipients: [{ via: "operator_key", name: "OpenAI" }],
      };
      const html = render();
      expect(html).not.toContain('data-slot="ai-consent-withdraw"');
      expect(html).not.toContain("Agree");
      expect(html).not.toContain('data-slot="ai-consent"');
    },
  );

  it("holds its space while the account payload is loading, claiming nothing", () => {
    consentState.authLoading = true;
    const html = render();
    expect(html).toContain('data-slot="ai-consent"');
    expect(html).not.toContain('data-slot="ai-consent-withdraw"');
    expect(html).not.toContain("Given on");
  });

  it("says nothing when the payload carries no consent state", () => {
    const html = render();
    expect(html).not.toContain('data-slot="ai-consent"');
    expect(html).not.toContain('data-slot="ai-consent-withdraw"');
  });

  it("renders nothing for a signed-out visitor", () => {
    consentState.value = {
      status: "given",
      since: "2026-07-01T08:00:00.000Z",
      recipients: [],
    };
    expect(render(false)).toBe("");
  });
});
