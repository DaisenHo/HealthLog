import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import { PreviewSection } from "../preview-section";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

function render(topics: boolean | undefined, locale: "en" | "de" = "en") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnMount: false } },
  });
  if (topics !== undefined) {
    client.setQueryData(queryKeys.previewFeatures(), { topics });
  }
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <QueryClientProvider client={client}>
        <PreviewSection />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("<PreviewSection>", () => {
  it("shows the Topics switch off by default, saved on change", () => {
    const html = render(false);
    expect(html).toContain('data-slot="settings-preview-topics-switch"');
    expect(html).toMatch(
      /data-slot="settings-preview-topics-switch"[^>]*aria-checked="false"|aria-checked="false"[^>]*data-slot="settings-preview-topics-switch"/,
    );
    expect(html).toContain("Topics (beta)");
    // A switch, no Save: one save model per card.
    expect(html).not.toContain('type="submit"');
  });

  it("reads on once the person switched it on", () => {
    expect(render(true)).toMatch(
      /data-slot="settings-preview-topics-switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-slot="settings-preview-topics-switch"/,
    );
  });

  it("says the existing pages stay as they are and nothing raw leaks", () => {
    const html = render(false, "de");
    expect(html).toContain("Themen (Beta)");
    expect(html).not.toContain("settings.preview.");
  });
});
