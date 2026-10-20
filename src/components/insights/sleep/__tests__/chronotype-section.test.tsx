import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import type { SleepRhythmDto } from "../use-sleep-rhythm";

/**
 * v1.18.7 — chronotype SECTION states (the prominent bottom block).
 *
 * Mirrors the sleep-rhythm section guard: error → quiet inline notice,
 * loading → skeleton, settled → the large band treatment. `useAuth` +
 * `useSleepRhythm` are mocked so each branch is deterministic.
 */

const authMock = vi.fn();
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => authMock(),
}));

const rhythmMock = vi.fn();
vi.mock("../use-sleep-rhythm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../use-sleep-rhythm")>();
  return { ...actual, useSleepRhythm: () => rhythmMock() };
});

const { ChronotypeSection } = await import("../chronotype-section");

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const READY_DTO: SleepRhythmDto = {
  sleepDebt: {
    state: "ready",
    debtMinutes: 600,
    needMinutes: 420,
    nightsCounted: 10,
    windowNights: 14,
    nightsUntilReady: 0,
    source: "COMPUTED",
  },
  chronotype: {
    state: "ready",
    msfMinutes: 5 * 60 + 41, // 05:41
    msfScMinutes: 5 * 60,
    band: "late",
    socialJetlagMinutes: 75,
    freeNightsCounted: 6,
    workNightsCounted: 14,
    freeNightsUntilReady: 0,
  },
  averagePerNight: {
    state: "ready",
    averageMinutes: 420,
    nightsCounted: 10,
    nightsUntilReady: 0,
  },
};

beforeEach(() => {
  authMock.mockReturnValue({ isAuthenticated: true });
  rhythmMock.mockReset();
});

describe("<ChronotypeSection>", () => {
  it("renders nothing on a query error — the page owns the one notice", () => {
    // All three rhythm cards resolve the same query, so a per-card notice
    // printed the identical sentence three times. /insights/sleep now renders
    // a single QueryErrorCard with a retry in place of the row. The card must
    // still not fall through to its skeleton, which would spin forever.
    rhythmMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    const html = render(<ChronotypeSection enabled />);
    expect(html).toBe("");
    expect(html).not.toContain('data-slot="chronotype-loading"');
  });

  it("shows the skeleton while loading", () => {
    rhythmMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const html = render(<ChronotypeSection enabled />);
    expect(html).toContain('data-slot="chronotype-loading"');
    expect(html).not.toContain('data-slot="chronotype-error"');
  });

  it("renders the band value + midpoint clock on a settled DTO", () => {
    rhythmMock.mockReturnValue({
      data: READY_DTO,
      isLoading: false,
      isError: false,
    });
    const html = render(<ChronotypeSection enabled />);
    expect(html).toContain('data-slot="chronotype-band"');
    expect(html).toContain("Evening type");
    expect(html).toContain("05:41");
    // v1.19.0 — the duplicate standalone section heading is gone; the single
    // chronotype title now lives inside the card, uniform with the debt tile.
    expect(html).not.toContain('data-slot="section-heading"');
    expect(html).toContain('data-slot="chronotype-card"');
  });

  it("renders nothing when disabled", () => {
    rhythmMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    const html = render(<ChronotypeSection enabled={false} />);
    expect(html).toBe("");
  });
});
