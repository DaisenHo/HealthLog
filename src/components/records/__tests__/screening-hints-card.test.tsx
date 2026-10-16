import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ScreeningHintsCard } from "@/components/records/screening-hints-card";
import { I18nProvider } from "@/lib/i18n/context";
import type { LifeCircumstancesDto } from "@/lib/profile/life-circumstances";
import type { ScreeningHint } from "@/lib/profile/life-derived";
import { queryKeys } from "@/lib/query-keys";

function hint(
  id: ScreeningHint["id"],
  status: ScreeningHint["status"],
): ScreeningHint {
  return {
    id,
    status,
    reasonKeys: [],
    region: "DE",
    sourceLabel: "source",
    sourceUrl: "https://example.org/",
  };
}

function render(tobaccoFacts: number, hints: ScreeningHint[]): string {
  const dto = {
    sections: [
      {
        key: "tobacco",
        facts: Array.from({ length: tobaccoFacts }, () => ({})),
      },
    ],
    derived: { screeningHints: hints },
  } as unknown as LifeCircumstancesDto;
  const client = new QueryClient();
  client.setQueryData(queryKeys.lifeCircumstances(), dto);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="en">
        <ScreeningHintsCard />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("ScreeningHintsCard", () => {
  it("stays away while nothing applies and smoking is unanswered", () => {
    expect(
      render(0, [
        hint("lung_ldct", "unknown"),
        hint("aaa_ultrasound", "not_eligible"),
      ]),
    ).toBe("");
  });

  // The German abdominal-aorta ultrasound applies to every man from 65,
  // whether he ever smoked or not: the hint must reach him without a
  // smoking answer.
  it("shows a hint that applies without a smoking answer", () => {
    const html = render(0, [
      hint("lung_ldct", "unknown"),
      hint("aaa_ultrasound", "suggested"),
    ]);
    expect(html).toContain('data-slot="screening-hints-card"');
    expect(html).toContain('data-slot="screening-hint-aaa_ultrasound"');
  });

  it("shows once smoking is answered", () => {
    expect(
      render(1, [
        hint("lung_ldct", "not_eligible"),
        hint("aaa_ultrasound", "not_eligible"),
      ]),
    ).toContain('data-slot="screening-hints-card"');
  });
});
