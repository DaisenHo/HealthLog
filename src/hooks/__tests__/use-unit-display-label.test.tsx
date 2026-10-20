import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null }),
  useAccountOnceMounted: () => null,
}));

import { useUnitDisplay } from "@/hooks/use-unit-display";
import { I18nProvider } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/config";

import de from "../../../messages/de.json";
import en from "../../../messages/en.json";

const BUNDLES = { de, en } as const;

function Units({ types }: { types: string[] }) {
  const units = useUnitDisplay();
  return <>{types.map((type) => units.unitFor(type)).join("|")}</>;
}

function unitsIn(locale: Locale & keyof typeof BUNDLES, types: string[]) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale} initialMessages={BUNDLES[locale]}>
      <Units types={types} />
    </I18nProvider>,
  ).split("|");
}

// The display unit is the reader's, not the storage token: a German
// account read "15,4 breaths/min" on the vitals tile.
describe("useUnitDisplay().unitFor", () => {
  it("speaks the reader's language for word-shaped units", () => {
    expect(
      unitsIn("de", ["RESPIRATORY_RATE", "VASCULAR_AGE", "TIME_IN_DAYLIGHT"]),
    ).toEqual(["Atemzüge/min", "Jahre", "Min."]);
    expect(unitsIn("en", ["RESPIRATORY_RATE"])).toEqual(["breaths/min"]);
  });

  it("keeps symbols and drops kind markers", () => {
    expect(
      unitsIn("de", ["WEIGHT", "BODY_TEMPERATURE", "RECOVERY_SCORE"]),
    ).toEqual(["kg", "°C", ""]);
  });
});
