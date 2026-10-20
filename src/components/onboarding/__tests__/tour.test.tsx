import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// vitest runs in the Node environment (no jsdom). The tour's interactive
// behaviour (keyboard navigation, focus management, target measurement,
// cross-page navigation) is exercised by the pure state machine at
// `src/lib/onboarding/__tests__/tour-state.test.ts` and by the e2e
// suite at `e2e/onboarding-tour.spec.ts`. Here we lock the SSR contract:
// initial render shape, ARIA wiring, i18n keys, and that the first step
// is the dashboard overview.
//
// The overlay reads Next's navigation hooks for the cross-page push; we
// stub them so the static render resolves.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

import { I18nProvider } from "@/lib/i18n/context";
import { OnboardingTour } from "../tour";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

function renderTour(modules?: Record<string, boolean>) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">
      <OnboardingTour modules={modules} onClose={vi.fn()} />
    </I18nProvider>,
  );
}

describe("<OnboardingTour>", () => {
  it("renders a modal dialog with role=dialog and aria-modal=true", () => {
    const html = renderTour();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="onboarding-tour-title"');
  });

  it("starts on the dashboard-overview step (1 of 15 by default)", () => {
    const html = renderTour();
    expect(html).toContain("Step 1 of 15");
  });

  it("keeps the counter honest when modules are disabled", () => {
    // cycle + mood + achievements off ⇒ 12 stops.
    const html = renderTour({
      cycle: false,
      mood: false,
      achievements: false,
    });
    expect(html).toContain("Step 1 of 12");
  });

  it("exposes a skip control with an accessible label", () => {
    const html = renderTour();
    expect(html).toContain("Skip tour");
  });

  it("renders both the Skip button and the primary Next button on the first step", () => {
    const html = renderTour();
    expect(html).toContain("Skip tour");
    expect(html).toContain(">Next<");
  });

  it("attaches a stable test hook for the primary action so e2e can drive it", () => {
    const html = renderTour();
    expect(html).toContain('data-testid="onboarding-tour-primary"');
    expect(html).toContain('data-testid="onboarding-tour-tooltip"');
    expect(html).toContain('data-testid="onboarding-tour"');
  });

  it("places a polite live region announcing the current step", () => {
    const html = renderTour();
    expect(html).toContain('aria-live="polite"');
  });

  it("German locale resolves the tour i18n keys end-to-end", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="de">
        <OnboardingTour onClose={vi.fn()} />
      </I18nProvider>,
    );
    expect(html).toContain("Schritt 1 von 15");
    expect(html).toContain("Tour überspringen");
  });
});
