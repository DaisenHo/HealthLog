/**
 * The two "withheld by contract" notes: the Withings card names what the
 * account's API plan refuses, the Oura card asks for one reconnect when the
 * grant lacks a scope. Both render nothing when nothing is withheld, and both
 * render the server-resolved list rather than deriving one.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import { WithingsPlanNote } from "../withings-plan-note";
import { OuraScopeNote } from "../oura-scope-note";

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

describe("<WithingsPlanNote>", () => {
  it("lists the withheld readings and links the Withings plans page", () => {
    const html = render(
      <WithingsPlanNote features={["spo2", "vascularAge", "ecg"]} />,
    );
    expect(html).toContain('data-testid="withings-plan-note"');
    expect(html).toContain("SpO2, vascular age, and ECG and AFib");
    expect(html).toContain("Weight, blood pressure, body composition");
    expect(html).toContain(
      "https://static.withings.com/content/api/plans/plans.html",
    );
  });

  it("speaks the reader's language", () => {
    const html = render(<WithingsPlanNote features={["vascularAge"]} />, "de");
    expect(html).toContain("Gefäßalter");
    expect(html).toContain("kostenpflichtigen API-Plan");
  });

  it("renders nothing when the plan withholds nothing", () => {
    expect(render(<WithingsPlanNote features={[]} />)).toBe("");
    expect(render(<WithingsPlanNote features={undefined} />)).toBe("");
  });
});

describe("<OuraScopeNote>", () => {
  it("asks for one reconnect naming the collections the grant lacks", () => {
    const html = render(
      <OuraScopeNote
        collections={["spo2", "vo2max", "cardio_age", "resilience"]}
        onReconnect={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="oura-scope-note"');
    expect(html).toContain(
      "Reconnect Oura once to allow SpO2, VO2 max, cardiovascular age, and resilience.",
    );
    expect(html).toContain('data-testid="oura-scope-reconnect"');
  });

  it("renders nothing when the grant covers everything", () => {
    expect(
      render(<OuraScopeNote collections={[]} onReconnect={vi.fn()} />),
    ).toBe("");
  });
});
