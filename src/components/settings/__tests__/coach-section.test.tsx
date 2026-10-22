/**
 * v1.18.0 — Settings → Coach section.
 *
 * The Coach preference cards (state, preferences, memory) moved out of the
 * AI / Assistant section into their own dedicated, module-gated entry.
 * SSR-only smoke test — interactive contracts live in the cards' own suites
 * (`coach-memory-section.test.tsx`; the switch in `modules-section.test.tsx`).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings/coach",
}));

// Past hydration only where a test says so: the gate reads the account once
// mounted, and the pre-hydration pass shows every card.
const mountState = { mounted: false };
vi.mock("@/hooks/use-mounted", () => ({
  useMounted: () => mountState.mounted,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
  useInfiniteQuery: () => ({ data: undefined, isLoading: false }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// The reminders card reads the Coach capability off `/api/auth/me`; the
// react-query mock above carries no context for the real hook to read.
vi.mock("@/hooks/use-ai-capability", () => ({
  useAiCapability: () => ({
    available: true,
    reason: null,
    onDeviceAllowed: true,
  }),
  // v1.41 — the thinking depth reads the resolved block; none here.
  useCoachReasoning: () => null,
}));

const authState: {
  disableCoach: boolean;
  modules: { coach?: boolean } | undefined;
} = { disableCoach: false, modules: undefined };
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      role: "USER",
      disableCoach: authState.disableCoach,
      modules: authState.modules,
    },
    isAuthenticated: true,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

import { I18nProvider } from "@/lib/i18n/context";
import { SettingsSectionFrame } from "./section-frame-harness";
import { CoachSection } from "../coach-section";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

function render(locale: "en" | "de" = "en") {
  // v1.18.6 — the visible heading lives in the shared frame the route
  // wraps the section in; render through it so the heading id is present.
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <SettingsSectionFrame slug="coach">
        <CoachSection />
      </SettingsSectionFrame>
    </I18nProvider>,
  );
}

describe("<CoachSection> — SSR smoke", () => {
  it("shows the Coach state with a link to the one switch, not a second switch", () => {
    authState.disableCoach = false;
    const html = render();
    expect(html).toContain('id="settings-section-coach-title"');
    expect(html).toContain('data-slot="settings-coach-state-card"');
    expect(html).toContain('data-enabled="true"');
    expect(html).toContain('href="/settings/modules#module-coach"');
    // v1.44 — no switch of its own: one state, one control, in Modules.
    const card = html.match(
      /data-slot="settings-coach-state-card"[\s\S]*?<\/a>/,
    )?.[0];
    expect(card).toBeDefined();
    expect(card).not.toContain('role="switch"');
    expect(html).not.toContain("settings-disable-coach");
    // Raw key never leaks past i18n.
    expect(html).not.toContain("settings.sections.coach.");
    expect(html).not.toContain("settings.coach.state.");
  });

  it("reads off once the account has the Coach off", () => {
    mountState.mounted = true;
    authState.disableCoach = true;
    try {
      expect(render()).toContain('data-enabled="false"');
    } finally {
      mountState.mounted = false;
      authState.disableCoach = false;
    }
  });

  it("points the nudges at Settings > Notifications", () => {
    const html = render();
    expect(html).toContain('href="/settings/notifications#coach-nudge"');
    expect(html).not.toContain('id="coach-nudge"');
  });

  it("renders the German copy", () => {
    const html = render("de");
    expect(html).not.toContain("settings.sections.coach.");
    expect(html).not.toContain("settings.coach.state.");
  });
});

describe("<CoachSection> — the tuning follows the record, not the account", () => {
  it("hides the nudge pointer when the record has the Coach off, whatever the viewer's own opt-out says", () => {
    // A guardian with the Coach on, inside a managed record that has it off:
    // `/me` publishes the viewer's own `disableCoach` and the RECORD's module
    // map. The record's answer decides.
    mountState.mounted = true;
    authState.disableCoach = false;
    authState.modules = { coach: false };
    try {
      expect(render()).not.toContain('data-slot="settings-coach-nudge-link"');
      authState.disableCoach = true;
      authState.modules = { coach: true };
      expect(render()).toContain('data-slot="settings-coach-nudge-link"');
    } finally {
      mountState.mounted = false;
      authState.disableCoach = false;
      authState.modules = undefined;
    }
  });
});
