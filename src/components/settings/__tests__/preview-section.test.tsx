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

const switchState = (html: string, state: "true" | "false") =>
  new RegExp(
    `data-slot="settings-preview-topics-switch"[^>]*aria-checked="${state}"|aria-checked="${state}"[^>]*data-slot="settings-preview-topics-switch"`,
  ).test(html);

describe("<PreviewSection>", () => {
  it("shows the Topics switch off by default, saved on change", () => {
    const html = render(false);
    expect(switchState(html, "false")).toBe(true);
    expect(html).toContain("Topics");
    expect(html).toContain('data-slot="preview-badge"');
    // A switch, no Save: one save model per card.
    expect(html).not.toContain('type="submit"');
    // Nothing to open while it is off.
    expect(html).not.toContain('data-slot="settings-preview-topics-open"');
  });

  it("reads on once the person switched it on and offers the way in", () => {
    const html = render(true);
    expect(switchState(html, "true")).toBe(true);
    expect(html).toMatch(
      /data-slot="settings-preview-topics-open"[^>]*href="\/topics"|href="\/topics"[^>]*data-slot="settings-preview-topics-open"/,
    );
  });

  it("names the switch by its visible title and leaks no raw key", () => {
    const html = render(false, "de");
    expect(html).toContain('aria-labelledby="settings-preview-topics-title"');
    expect(html).toContain("Themen");
    expect(html).not.toContain("settings.preview.");
    expect(html).not.toContain("nav.previewBadge");
  });
});
