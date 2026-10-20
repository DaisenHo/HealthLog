import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import type { SleepRhythmDto } from "../use-sleep-rhythm";

/**
 * v1.17.0 — sleep-rhythm SECTION states.
 *
 * The cards' own partial/learning copy is covered in `sleep-rhythm-cards`;
 * this file pins the section wrapper's three states, mirroring the glucose
 * clinical panel's treatment:
 *   - a query error renders a quiet inline notice, NOT an endless skeleton
 *   - loading (and settled-but-undefined) shows the skeletons
 *   - a settled DTO renders the sleep-debt card
 * `useAuth` + `useSleepRhythm` are mocked so each branch is deterministic.
 *
 * v1.18.7 — the chronotype card moved out to `<ChronotypeSection>` (the
 * prominent bottom block); this section now owns the sleep-debt headline alone.
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

// Import after the mocks are registered.
const { SleepRhythmSection } = await import("../sleep-rhythm-section");

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const READY_DTO: SleepRhythmDto = {
  sleepDebt: {
    state: "ready",
    debtMinutes: 60,
    needMinutes: 420,
    nightsCounted: 5,
    windowNights: 5,
    nightsUntilReady: 0,
    source: "COMPUTED",
  },
  chronotype: {
    state: "ready",
    msfMinutes: 4 * 60 + 30,
    msfScMinutes: 4 * 60,
    band: "intermediate",
    socialJetlagMinutes: 75,
    freeNightsCounted: 6,
    workNightsCounted: 14,
    freeNightsUntilReady: 0,
  },
  averagePerNight: {
    state: "ready",
    averageMinutes: 420,
    nightsCounted: 5,
    nightsUntilReady: 0,
  },
};

beforeEach(() => {
  authMock.mockReturnValue({ isAuthenticated: true });
  rhythmMock.mockReset();
});

describe("<SleepRhythmSection>", () => {
  it("renders nothing on a query error, and never an infinite skeleton", () => {
    // The shared-read notice moved to /insights/sleep so one failure prints
    // one message instead of three. The card must still bail rather than
    // fall through to a skeleton that can never resolve.
    rhythmMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    const html = render(<SleepRhythmSection enabled />);
    expect(html).toBe("");
    expect(html).not.toContain('data-slot="sleep-rhythm-loading"');
  });

  it("shows the skeletons while loading", () => {
    rhythmMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    const html = render(<SleepRhythmSection enabled />);
    expect(html).toContain('data-slot="sleep-rhythm-loading"');
    expect(html).not.toContain('data-slot="sleep-rhythm-error"');
  });

  it("renders the sleep-debt card on a settled DTO and NOT the chronotype", () => {
    rhythmMock.mockReturnValue({
      data: READY_DTO,
      isLoading: false,
      isError: false,
    });
    const html = render(<SleepRhythmSection enabled />);
    expect(html).toContain("1h 0m short");
    // The chronotype band lives in the separate sibling tile, never here.
    expect(html).not.toContain("Intermediate type");
    expect(html).not.toContain('data-slot="chronotype-band"');
  });

  it("renders nothing when disabled", () => {
    rhythmMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
    });
    const html = render(<SleepRhythmSection enabled={false} />);
    expect(html).toBe("");
  });
});
