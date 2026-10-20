import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";

/**
 * v1.30 — the ECG entry in the Heart-group tab strip.
 *
 * ECG carries no `MeasurementType`, so it can't ride the metric
 * `availability` model; the strip gates it on the dedicated
 * `hasEcgRecordings` signal instead. The load-bearing product rule under
 * test: the Heart group (hence the ECG entry) appears ONLY when the account
 * has recordings — we never surface a data-less ECG target on the busy nav.
 *
 * The ECG child lives inside the Heart popover, which Radix renders only on
 * open (portal); SSR markup therefore can't show the child label directly.
 * These tests pin the gate through the Heart group's PRESENCE with no other
 * heart-metric data, so the group appears solely because of ECG.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/insights",
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { InsightsTabStrip } from "../insights-tab-strip";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">{node}</I18nProvider>,
  );
}

describe("<InsightsTabStrip> — ECG gate (H1)", () => {
  it("hides the Heart group (no ECG pill) when the account has no recordings", () => {
    // No availability + no ECG → only the always-present pills, no Heart group.
    const html = render(<InsightsTabStrip hasEcgRecordings={false} />);
    expect(html).not.toContain('data-group="heart"');
  });

  it("hides the ECG pill when `hasEcgRecordings` is absent (default off, first paint)", () => {
    const html = render(<InsightsTabStrip />);
    expect(html).not.toContain('data-group="heart"');
  });

  it("shows the Heart group for an ECG-only account (recordings, no other heart data)", () => {
    // An ECG-only device has no pulse / resting-HR / HRV rows, so no
    // Heart-metric pill would light the group — the group appears solely
    // because the ECG fallback emits it.
    const html = render(<InsightsTabStrip hasEcgRecordings={true} />);
    expect(html).toContain('data-group="heart"');
  });
});
