import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import en from "../../../../messages/en.json";
import ptBR from "../../../../messages/pt-BR.json";

/**
 * The expandable per-item answer breakdown (the read side of
 * `responsesEncrypted`). SSR-only convention (`renderToStaticMarkup`) — the
 * detail query is seeded into the cache, the fetch never runs.
 *
 * Pins: the official item texts render from the SAME `mentalHealth.items.*`
 * keys the check-in wizard uses (validated instrument copy, never re-worded),
 * each answer shows its option label + value, PHQ-9 item 9 gets NO alarm
 * styling, and the server's decrypt-failure degrade renders as the honest
 * unavailable line rather than a blank.
 */

vi.mock("@/lib/api/api-fetch", () => ({
  apiGet: () => new Promise(() => {}),
  apiPost: () => new Promise(() => {}),
}));

import { AssessmentItemBreakdown } from "../assessment-item-breakdown";
import type { AssessmentDetail } from "../types";

const mh = en.mentalHealth;

function detailRow(overrides: Partial<AssessmentDetail>): AssessmentDetail {
  return {
    id: "mha_1",
    instrument: "PHQ9",
    locale: "en",
    totalScore: 10,
    severityBand: "moderate",
    item9Flagged: true,
    crisisShownAt: null,
    takenAt: "2026-06-28T00:00:00.000Z",
    items: [1, 1, 1, 1, 1, 1, 1, 1, 2],
    functionalDifficulty: null,
    itemsUnavailable: false,
    ...overrides,
  };
}

function render(
  detail: AssessmentDetail,
  locale: "en" | "pt-BR" = "en",
  messages?: Record<string, unknown>,
): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(queryKeys.mentalHealthAssessmentDetail(detail.id), {
    assessment: detail,
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale={locale} initialMessages={messages}>
        <AssessmentItemBreakdown
          assessmentId={detail.id}
          instrument={detail.instrument}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("AssessmentItemBreakdown", () => {
  it("renders every official PHQ-9 item text with its answer label + value", () => {
    const html = render(detailRow({}));
    // All nine validated item texts, from the wizard's own keys.
    for (let n = 1; n <= 9; n++) {
      expect(html).toContain(
        mh.items.phq9[String(n) as keyof typeof mh.items.phq9],
      );
    }
    // Answer labels are the shared PHQ/GAD anchors.
    expect(html).toContain(mh.options["1"]);
    expect(html).toContain(mh.options["2"]);
  });

  it("gives PHQ-9 item 9 no alarm styling — it renders like every other item", () => {
    const html = render(detailRow({}));
    expect(html).toContain(mh.items.phq9["9"]);
    expect(html).not.toContain("text-destructive");
  });

  it("renders the unscored functional follow-up when it was answered", () => {
    const html = render(detailRow({ functionalDifficulty: 2 }));
    expect(html).toContain(mh.functionalTitle);
    expect(html).toContain(mh.functional["2"]);
  });

  it("omits the functional follow-up row when it was not answered", () => {
    const html = render(detailRow({ functionalDifficulty: null }));
    expect(html).not.toContain(mh.functionalTitle);
  });

  it("paints the WHO-5 recall stem once above its run of items", () => {
    const html = render(
      detailRow({
        instrument: "WHO5",
        items: [5, 4, 3, 2, 1],
        item9Flagged: false,
      }),
    );
    // The shared stem appears exactly once, not per item.
    const stem = mh.stems.who5.period;
    expect(html.split(stem).length - 1).toBe(1);
    expect(html).toContain(mh.items.who5["1"]);
    expect(html).toContain(mh.who5Options["5"]);
  });

  it("renders the honest unavailable line on the server's decrypt degrade", () => {
    const html = render(detailRow({ items: null, itemsUnavailable: true }));
    expect(html).toContain(mh.history.answersUnavailable);
    expect(html).not.toContain(mh.items.phq9["1"]);
  });

  it("shows the English PHQ-9 items to a pt-BR reader, even from a bundle that carries a translation", () => {
    // A drifted pt-BR bundle with the self-made wording the release once
    // shipped. The PHQ-9 is not validated in Brazilian Portuguese, so none
    // of it may reach the page.
    const drifted = structuredClone(ptBR) as Record<string, unknown>;
    const mhDrifted = drifted.mentalHealth as Record<string, unknown>;
    mhDrifted.items = {
      phq9: {
        "9": "Pensamentos de que estaria melhor morto, ou de se machucar de alguma forma",
      },
    };
    mhDrifted.options = { "2": "Mais da metade dos dias" };
    mhDrifted.functionalTitle = "Se você assinalou algum problema";
    const html = render(
      detailRow({ functionalDifficulty: 1 }),
      "pt-BR",
      drifted,
    );
    expect(html).toContain(mh.items.phq9["9"]);
    expect(html).toContain(mh.options["2"]);
    expect(html).toContain(mh.functionalTitle);
    expect(html).not.toContain("Pensamentos de que estaria melhor morto");
    expect(html).not.toContain("Mais da metade dos dias");
    expect(html).not.toContain("Se você assinalou");
  });
});
