import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Activity } from "lucide-react";

import { TrendCard } from "../trend-card";
import { I18nProvider } from "@/lib/i18n/context";

/**
 * v1.4.16 — TrendCard comparison delta callout.
 *
 * The tile picks up an optional `compareBaseline` + `compareDelta`
 * pair. When both are set, the second-line callout renders with
 * sentiment-aware colour (down-bad metric + improvement → green; etc).
 * When the baseline is "none" or the delta is null we paint the tile
 * exactly as before — strict regression guard.
 */

describe("<TrendCard compareBaseline=...>", () => {
  it("renders no comparison delta callout when baseline is 'none' (regression guard)", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <TrendCard
          label="Weight"
          latest={80.4}
          unit="kg"
          avg7={80}
          avg30={80.5}
          slope30={null}
          icon={Activity}
          directionSentiment="up-bad"
          compareBaseline="none"
          compareDelta={-2.3}
        />
      </I18nProvider>,
    );
    expect(html).not.toContain('data-slot="tile-compare-delta"');
  });

  it("renders the callout when compareBaseline is set and a delta is supplied", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <TrendCard
          label="Weight"
          latest={80.4}
          unit="kg"
          avg7={80}
          avg30={80.5}
          slope30={null}
          icon={Activity}
          directionSentiment="up-bad"
          compareBaseline="lastMonth"
          compareDelta={-2.3}
        />
      </I18nProvider>,
    );
    expect(html).toContain('data-slot="tile-compare-delta"');
    expect(html).toContain('data-compare-baseline="lastMonth"');
    // Caption text in EN should mention "last month".
    expect(html).toMatch(/last month/i);
    // Δ rendered with the delta value.
    expect(html).toContain("Δ");
  });

  it("paints an up-bad metric improving (negative delta) with the green sentiment class", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <TrendCard
          label="Weight"
          latest={80.4}
          unit="kg"
          avg7={80}
          avg30={80.5}
          slope30={null}
          icon={Activity}
          directionSentiment="up-bad"
          compareBaseline="lastMonth"
          compareDelta={-2.3}
        />
      </I18nProvider>,
    );
    // Down-trend on an up-bad metric is "improvement" → green.
    expect(html).toMatch(/text-success/);
  });

  it("paints an up-good metric worsening (negative delta) with the orange sentiment class", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <TrendCard
          label="Mood"
          latest={2.5}
          unit="/ 5"
          avg7={2.6}
          avg30={3}
          slope30={null}
          icon={Activity}
          directionSentiment="up-good"
          compareBaseline="lastYear"
          compareDelta={-0.5}
        />
      </I18nProvider>,
    );
    expect(html).toMatch(/text-warning/);
  });

  it("renders muted color when delta is exactly zero (stable)", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <TrendCard
          label="Pulse"
          latest={70}
          unit="bpm"
          avg7={70}
          avg30={70}
          slope30={null}
          icon={Activity}
          directionSentiment="neutral"
          compareBaseline="lastMonth"
          compareDelta={0}
        />
      </I18nProvider>,
    );
    // Stable + neutral both push to muted-foreground.
    expect(html).toMatch(/text-muted-foreground/);
    // Sentiment colour classes must not appear for a stable delta.
    expect(html).not.toMatch(/text-success.*tile-compare-delta/);
    expect(html).not.toMatch(/text-warning.*tile-compare-delta/);
  });

  it("suppresses the callout when compareDelta is null (insufficient prior-period data)", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="en">
        <TrendCard
          label="Weight"
          latest={80}
          unit="kg"
          avg7={80}
          avg30={80}
          slope30={null}
          icon={Activity}
          directionSentiment="up-bad"
          compareBaseline="lastMonth"
          compareDelta={null}
        />
      </I18nProvider>,
    );
    expect(html).not.toContain('data-slot="tile-compare-delta"');
  });
});
