import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import type { AiConsentState } from "@/lib/ai/capabilities/types";
import { I18nProvider } from "@/lib/i18n/context";

/**
 * The consent question for the operator's provider. What these pin: it is
 * asked only while `ai.consent` says it is needed and the person could set AI
 * up here; it names the service the server named and the data that would go
 * there; its one button is the consent act, and the request that button
 * sends carries the explicit confirmation the server requires.
 *
 * Static markup (the house convention, no jsdom), so the click itself is not
 * dispatched: `useMutation` is captured and its `mutationFn` invoked.
 */
const state = vi.hoisted(() => ({
  consent: null as AiConsentState | null,
  canConfigure: true,
  mounted: true,
}));
const mutations = vi.hoisted(
  () => [] as Array<{ mutationFn?: () => Promise<unknown> }>,
);
const apiPost = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/use-ai-capability", () => ({
  useAiConsent: () => state.consent,
  useAiProviderState: () => ({
    configured: true,
    managedBy: "server",
    canConfigure: state.canConfigure,
    responseTimeoutMs: 60_000,
  }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" } }),
}));
vi.mock("@/hooks/use-mounted", () => ({ useMounted: () => state.mounted }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn?: () => Promise<unknown> }) => {
    mutations.push(options);
    return { mutate: () => {}, isPending: false, isError: false };
  },
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock("@/lib/api/api-fetch", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiPost,
}));

import { AiConsentRequest } from "../ai-consent-request";

const NEEDED: AiConsentState = {
  status: "needed",
  since: null,
  recipients: [{ via: "operator_key", name: "OpenAI" }],
};

function render(surface: "settings" | "insights") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <AiConsentRequest surface={surface} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  state.consent = NEEDED;
  state.canConfigure = true;
  state.mounted = true;
  mutations.length = 0;
  apiPost.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    /* no window in this environment */
  }
});

describe("AiConsentRequest", () => {
  it.each(["settings", "insights"] as const)(
    "on %s, names the service and the data and offers one Agree",
    (surface) => {
      const html = render(surface);
      expect(html).toContain('data-slot="ai-consent-request"');
      expect(html).toContain("OpenAI");
      expect(html).toContain("blood pressure");
      expect(html).toContain("withdraw");
      expect(html.match(/data-slot="ai-consent-request-agree"/g)).toHaveLength(
        1,
      );
    },
  );

  it.each(["given", "not_needed"] as const)(
    "asks nothing while consent is %s",
    (status) => {
      state.consent = { ...NEEDED, status };
      expect(render("settings")).toBe("");
      expect(render("insights")).toBe("");
    },
  );

  it("asks nothing before the account payload has answered", () => {
    state.consent = null;
    expect(render("settings")).toBe("");
  });

  it("asks nothing of somebody who cannot set AI up for this record", () => {
    state.canConfigure = false;
    expect(render("settings")).toBe("");
  });

  it("paints no tile on the overview before hydration", () => {
    state.mounted = false;
    expect(render("insights")).toBe("");
  });

  it("sends the explicit confirmation, and only that", async () => {
    render("settings");
    expect(mutations).toHaveLength(1);
    await mutations[0]!.mutationFn!();
    expect(apiPost).toHaveBeenCalledWith("/api/consent/ai/web", {
      confirm: true,
    });
  });
});
