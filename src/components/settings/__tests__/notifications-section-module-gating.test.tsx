/**
 * Settings > Notifications is the one home for every reminder kind, each
 * card gated on its module and failing open.
 *
 * v1.18.0 — mood reminder on `mood`, low-stock on `medications`.
 * v1.44 — the Coach nudges came back (gated on the Coach surface), the
 * checkup reminder switches joined (not a module, always shown), and a card
 * names the reminders set where their subject lives (dose times on the
 * medication, the cycle reminders in the per-event matrix).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings/notifications",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Mounted, so the Coach gate reads the module map like a hydrated page.
vi.mock("@/hooks/use-mounted", () => ({ useMounted: () => true }));

const authRef: { modules?: Record<string, boolean> } = {};
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: { id: "u1", username: "t", role: "USER", modules: authRef.modules },
    isAuthenticated: true,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { NotificationsSection } from "../notifications-section";

function render(modules?: Record<string, boolean>) {
  authRef.modules = modules;
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <NotificationsSection />
    </I18nProvider>,
  );
}

describe("<NotificationsSection> reminder kinds", () => {
  it("shows every reminder card when no module map (fails open)", () => {
    const html = render(undefined);
    expect(html).toContain('id="mood-reminder"');
    expect(html).toContain('id="low-stock"');
    expect(html).toContain('id="coach-nudge"');
    expect(html).toContain('id="vorsorge-reminders"');
    expect(html).toContain('data-slot="notifications-elsewhere"');
    expect(html).toContain('id="cycle-reminders"');
  });

  it("hides the mood card when the mood module is disabled", () => {
    const html = render({ mood: false });
    expect(html).not.toContain('id="mood-reminder"');
    expect(html).toContain('id="low-stock"');
  });

  it("hides the low-stock card and the dose row when medications is disabled", () => {
    const html = render({ medications: false });
    expect(html).not.toContain('id="low-stock"');
    expect(html).not.toContain('href="/medications"');
  });

  it("hides the Coach nudges when the Coach is off", () => {
    expect(render({ coach: false })).not.toContain('id="coach-nudge"');
  });

  it("drops the elsewhere card when neither of its reminders applies", () => {
    const html = render({ medications: false, cycle: false });
    expect(html).not.toContain('data-slot="notifications-elsewhere"');
    // The checkup reminders are not a module and stay.
    expect(html).toContain('id="vorsorge-reminders"');
  });

  it("links to the per-event matrix and to the delivery channels", () => {
    const html = render({});
    expect(html).toContain('href="/notifications"');
    expect(html).toContain('href="/settings/integrations#channels"');
  });
});
