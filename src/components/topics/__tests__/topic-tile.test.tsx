import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import type { TopicOverviewEntry } from "@/lib/topics/build";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

import { TopicTile } from "../topic-tile";

primeLocales("de");

function render(entry: TopicOverviewEntry, locale: "en" | "de" = "en") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  });
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>
      <QueryClientProvider client={client}>
        <TopicTile entry={entry} />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

const heart: TopicOverviewEntry = {
  key: "heart",
  headline: {
    kind: "signal",
    key: "RESTING_HEART_RATE",
    value: 59,
    day: "2026-10-22",
  },
  summary: {
    code: "outside",
    signal: "RESTING_HEART_RATE",
    direction: "above",
    count: null,
    total: null,
  },
  tone: "watch",
  sparkline: [58, 59, 61],
  recorded: 2,
  total: 4,
};

describe("<TopicTile>", () => {
  it("links the visible title to the topic and words the server's sentence", () => {
    const html = render(heart);
    expect(html).toMatch(
      /href="\/topics\/heart"[^>]*data-slot="topic-tile-link"[^>]*>Heart<|data-slot="topic-tile-link"[^>]*href="\/topics\/heart"[^>]*>Heart</,
    );
    expect(html).toContain('data-code="outside"');
    expect(html).toContain("above your usual range");
    expect(html).toContain('data-tone="watch"');
    expect(html).toContain("2 of 4");
    expect(html).toMatch(/>59(\.0)?</);
  });

  it("speaks German and leaks no raw key", () => {
    const html = render(heart, "de");
    expect(html).toContain(">Herz<");
    expect(html).toContain("über deinem üblichen Bereich");
    expect(html).not.toMatch(/topics\.[a-z]/);
  });

  it("says a block headline in words, without a sparkline", () => {
    const html = render({
      ...heart,
      key: "metabolism",
      headline: { kind: "labs", inRange: 11, total: 12 },
      summary: {
        code: "labs",
        signal: null,
        direction: null,
        count: 11,
        total: 12,
      },
      tone: "watch",
      sparkline: [],
    });
    expect(html).toContain("11/12");
    expect(html).toContain("11 of 12 lab values");
  });
});
