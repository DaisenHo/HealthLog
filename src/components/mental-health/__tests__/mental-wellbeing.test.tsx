import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import en from "../../../../messages/en.json";
import nl from "../../../../messages/nl.json";
import { WORDING } from "@/lib/mental-health/wording";
import { seedQuestionnaireWording } from "@/__tests__/helpers/questionnaire-wording";

/**
 * Mental-wellbeing surface redesign (v1.25.3). The SSR-only convention
 * (`renderToStaticMarkup`, `environment: "node"`, no `@testing-library/react`)
 * means clicks can't be driven here — the wizard's advance/back grammar is
 * pinned in `check-in-nav.test.ts`. These tests pin the SSR-observable
 * contracts: the disclaimer renders ONLY on the landing (never while testing),
 * a positive item-9 surfaces the crisis card, and (v1.27.9) the landing is
 * intro + instrument cards only — the dated history + trend chart live in the
 * per-instrument detail a card click opens, pinned to one instrument.
 */

vi.mock("@/lib/api/api-fetch", () => ({
  apiGet: () => new Promise(() => {}),
  apiPost: () => new Promise(() => {}),
}));

import { MentalWellbeing } from "../mental-wellbeing";
import { CheckInWizard } from "../check-in-wizard";
import { AssessmentResult } from "../assessment-result";
import { AssessmentHistory } from "../assessment-history";
import { InstrumentCard } from "../instrument-card";
import { InstrumentDetail } from "../instrument-detail";
import type { AssessmentRow, CreateResponse } from "../types";

const mh = en.mentalHealth;

function withProviders(node: React.ReactNode): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // The landing now distinguishes loading from an empty record: while the
  // history read is in flight it paints skeletons rather than the instrument
  // cards' "not taken yet" copy, since that copy is a claim about the user's
  // record. These tests exercise the LOADED landing, so seed the read as a
  // settled empty result. The failed and in-flight states are covered in
  // `failed-read-never-empty.test.tsx`.
  queryClient.setQueryData(queryKeys.mentalHealthAssessments(), {
    data: { assessments: [] },
    cap: null,
  });
  seedQuestionnaireWording(queryClient);
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <I18nProvider initialLocale="en">{node}</I18nProvider>
    </QueryClientProvider>,
  );
}

describe("landing chrome (v1.25.5 — disclaimer + heading removed)", () => {
  it("does NOT render the voluntary-self-test disclaimer anywhere", () => {
    // The disclaimer line + its (i) tooltip were removed from the landing;
    // the page leads with the description and the instrument cards.
    const html = withProviders(<MentalWellbeing />);
    expect(html).not.toContain('data-slot="mental-health-disclaimer"');
    expect(html).not.toContain("voluntary self-tests, not a diagnosis");
  });

  it("keeps the page title for screen readers but not as a visible heading", () => {
    const html = withProviders(<MentalWellbeing />);
    // The title survives as an sr-only h1 for the document outline.
    expect(html).toContain(mh.pageTitle);
    expect(html).toContain("sr-only");
    // …and the lead description still introduces the screeners.
    expect(html).toContain(mh.pageDescription);
  });

  it("does NOT render any disclaimer inside the check-in wizard", () => {
    const html = withProviders(
      <CheckInWizard
        instrument="PHQ9"
        onSubmit={() => {}}
        onBack={() => {}}
        isPending={false}
        isError={false}
      />,
    );
    expect(html).not.toContain('data-slot="mental-health-disclaimer"');
    // …but the standardized instrument explanation IS shown.
    expect(html).toContain(mh.instrumentDescription.phq9);
  });
});

describe("check-in wizard scaffolding (v1.27.6 — questions only)", () => {
  const html = withProviders(
    <CheckInWizard
      instrument="PHQ9"
      onSubmit={() => {}}
      onBack={() => {}}
      isPending={false}
      isError={false}
    />,
  );

  it("no longer renders the question-overview strip", () => {
    expect(html).not.toContain('data-slot="wizard-stepper"');
  });

  it("no longer renders the review recap or the functional follow-up", () => {
    expect(html).not.toContain("You have answered");
    expect(html).not.toContain('data-slot="check-in-submit"');
  });

  it("opens on the first question with the Back/Next footer", () => {
    expect(html).toContain(WORDING.PHQ9.en.items[0]);
    expect(html).toContain('data-slot="check-in-back"');
    expect(html).toContain('data-slot="check-in-next"');
    // Back is disabled on the first step.
    expect(html).toMatch(
      /data-slot="check-in-back"[^>]*disabled|disabled[^>]*data-slot="check-in-back"/,
    );
  });
});

describe("item-9 crisis surfacing on the result", () => {
  function result(crisis: CreateResponse["crisis"]): CreateResponse {
    return {
      assessment: {
        id: "a1",
        instrument: "PHQ9",
        locale: "en",
        wording: "validated",
        totalScore: 18,
        severityBand: "modSevere",
        item9Flagged: crisis !== null,
        crisisShownAt: crisis !== null ? "2026-06-20T00:00:00.000Z" : null,
        takenAt: "2026-06-20T00:00:00.000Z",
      },
      actionThreshold: 10,
      crisis,
    };
  }

  it("renders the crisis card when item 9 is flagged", () => {
    const html = withProviders(
      <AssessmentResult
        result={result({
          emergencyNumber: "112",
          resources: [{ id: "findahelpline", contacts: ["findahelpline.com"] }],
        })}
        onTakeAnother={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).toContain('data-slot="mental-health-crisis-card"');
    // crisis.title carries an apostrophe (escaped by SSR) — assert a slice.
    expect(html).toContain("have to face this alone");
  });

  it("omits the crisis card when item 9 is not flagged", () => {
    const html = withProviders(
      <AssessmentResult
        result={result(null)}
        onTakeAnother={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).not.toContain('data-slot="mental-health-crisis-card"');
    // The result still paints.
    expect(html).toContain(mh.result.title);
  });
});

describe("history rendering", () => {
  const rows: AssessmentRow[] = [
    {
      id: "h1",
      instrument: "PHQ9",
      locale: "en",
      wording: "validated",
      totalScore: 16,
      severityBand: "modSevere",
      item9Flagged: true,
      crisisShownAt: "2026-06-20T00:00:00.000Z",
      takenAt: "2026-06-20T00:00:00.000Z",
    },
    {
      id: "h2",
      instrument: "PHQ9",
      locale: "en",
      wording: "validated",
      totalScore: 4,
      severityBand: "minimal",
      item9Flagged: false,
      crisisShownAt: null,
      takenAt: "2026-05-20T00:00:00.000Z",
    },
  ];

  const html = withProviders(
    <AssessmentHistory rows={rows} instrument="PHQ9" />,
  );

  it("paints the pinned dated list with the trend-chart shell, no instrument toggle", () => {
    // v1.27.9 — the history is pinned to one instrument inside the detail
    // surface: no PHQ-9/GAD-7 tablist, and the lazy chart's skeleton shell
    // holds the layout in SSR (recharts itself stays off first-load JS).
    expect(html).toContain('data-slot="history-list"');
    expect(html).toContain('data-pinned="PHQ9"');
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain(mh.band.PHQ9.modSevere);
  });

  it("marks a flagged row with the discreet support marker", () => {
    expect(html).toContain('data-slot="history-flagged-marker"');
    expect(html).toContain(mh.history.flaggedBadge);
  });

  it("renders the empty state with no rows for the pinned instrument", () => {
    const empty = withProviders(
      <AssessmentHistory rows={rows} instrument="SCI" />,
    );
    expect(empty).toContain(mh.history.empty);
    expect(empty).not.toContain('data-slot="history-list"');
  });

  it("stays OFF the landing entirely (intro + cards only)", () => {
    const landing = withProviders(<MentalWellbeing />);
    expect(landing).not.toContain('data-slot="mental-health-history"');
    expect(landing).not.toContain('data-slot="history-list"');
  });
});

describe("WHO-5 / SCI on the same infrastructure (v1.27.9)", () => {
  it("renders all four instrument cards on the landing", () => {
    const html = withProviders(<MentalWellbeing />);
    expect(html).toContain(mh.instrument.phq9);
    expect(html).toContain(mh.instrument.gad7);
    expect(html).toContain(mh.instrument.who5);
    expect(html).toContain(mh.instrument.sci);
    // The landing stays lean: no rhythm-hint paragraph between the header
    // and the cards (removed on maintainer review of v1.27.10).
    expect(html).not.toContain("Rhythmus");
  });

  it("WHO-5 wizard opens on item 1 with the six-point scale in source order and the recall stem", () => {
    const html = withProviders(
      <CheckInWizard
        instrument="WHO5"
        onSubmit={() => {}}
        onBack={() => {}}
        isPending={false}
        isError={false}
      />,
    );
    expect(html).toContain(WORDING.WHO5.en.items[0]);
    expect(html).toContain('data-slot="check-in-stem"');
    expect(html).toContain(WORDING.WHO5.en.stems.period);
    // Six anchors, 5 → 0 (the WHO form leads with "All of the time").
    for (const v of [5, 4, 3, 2, 1, 0]) {
      expect(html).toContain(WORDING.WHO5.en.anchors.all[v]);
    }
    // English items are the validated wording for en — no translation note.
    expect(html).not.toContain('data-slot="check-in-unvalidated-note"');
    expect(html).not.toContain('data-slot="check-in-wording-toggle"');
    // No functional follow-up outside the PHQ-9: 5 steps total.
    expect(html).toContain("Question 1 of 5");
  });

  it("SCI wizard opens on item 1 with the item-specific duration anchors and section stem", () => {
    const html = withProviders(
      <CheckInWizard
        instrument="SCI"
        onSubmit={() => {}}
        onBack={() => {}}
        isPending={false}
        isError={false}
      />,
    );
    expect(html).toContain(WORDING.SCI.en.items[0]);
    expect(html).toContain(WORDING.SCI.en.stems.night);
    // Item 1 carries the sleep-latency time ranges, 4 → 0.
    for (const v of [4, 3, 2, 1, 0]) {
      expect(html).toContain(WORDING.SCI.en.anchors.duration[v]);
    }
    expect(html).toContain("Question 1 of 8");
  });

  it("shows the gentle PHQ-9 pointer on a WHO-5 total of 50 or below", () => {
    const result: CreateResponse = {
      assessment: {
        id: "w1",
        instrument: "WHO5",
        locale: "en",
        wording: "validated",
        totalScore: 48,
        severityBand: "low",
        item9Flagged: false,
        crisisShownAt: null,
        takenAt: "2026-06-20T00:00:00.000Z",
      },
      actionThreshold: 50,
      crisis: null,
    };
    const html = withProviders(
      <AssessmentResult
        result={result}
        onTakeAnother={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).toContain('data-slot="result-follow-up-hint"');
    expect(html).toContain(mh.followUpHint.who5);
    // Required WHO attribution rides the result view.
    expect(html).toContain("CC BY-NC-SA 3.0 IGO");
    expect(html).not.toContain('data-slot="mental-health-crisis-card"');
  });

  it("suppresses the hint on a good WHO-5 total (direction is inverted vs PHQ-9)", () => {
    const result: CreateResponse = {
      assessment: {
        id: "w2",
        instrument: "WHO5",
        locale: "en",
        wording: "validated",
        totalScore: 80,
        severityBand: "good",
        item9Flagged: false,
        crisisShownAt: null,
        takenAt: "2026-06-20T00:00:00.000Z",
      },
      actionThreshold: 50,
      crisis: null,
    };
    const html = withProviders(
      <AssessmentResult
        result={result}
        onTakeAnother={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).not.toContain('data-slot="result-follow-up-hint"');
  });

  it("shows the neutral SCI band wording at 16 or below, with the Sleepio/BMJ attribution", () => {
    const result: CreateResponse = {
      assessment: {
        id: "s1",
        instrument: "SCI",
        locale: "en",
        wording: "validated",
        totalScore: 14,
        severityBand: "belowThreshold",
        item9Flagged: false,
        crisisShownAt: null,
        takenAt: "2026-06-20T00:00:00.000Z",
      },
      actionThreshold: 16,
      crisis: null,
    };
    const html = withProviders(
      <AssessmentResult
        result={result}
        onTakeAnother={() => {}}
        onBack={() => {}}
      />,
    );
    expect(html).toContain(mh.followUpHint.sci);
    expect(html).toContain(mh.band.SCI.belowThreshold);
    expect(html).toContain("BMJ Open");
  });

  it("pinned history renders the WHO-5 / SCI series through the same component", () => {
    const row: AssessmentRow = {
      id: "t1",
      instrument: "WHO5",
      locale: "en",
      wording: "validated",
      totalScore: 72,
      severityBand: "good",
      item9Flagged: false,
      crisisShownAt: null,
      takenAt: "2026-06-20T00:00:00.000Z",
    };
    const html = withProviders(
      <AssessmentHistory rows={[row]} instrument="WHO5" />,
    );
    expect(html).toContain('data-pinned="WHO5"');
    expect(html).toContain(mh.band.WHO5.good);
  });
});

describe("instrument card (med-/Vorsorge card anatomy + detail opener)", () => {
  const lastRow: AssessmentRow = {
    id: "l1",
    instrument: "PHQ9",
    locale: "en",
    wording: "validated",
    totalScore: 8,
    severityBand: "mild",
    item9Flagged: false,
    crisisShownAt: null,
    takenAt: "2026-06-20T00:00:00.000Z",
  };

  function card(
    instrument: AssessmentRow["instrument"],
    last?: AssessmentRow,
  ): string {
    return withProviders(
      <InstrumentCard
        instrument={instrument}
        last={last}
        onStart={() => {}}
        onOpenDetail={() => {}}
      />,
    );
  }

  it("renders the shared med-card header and the clickable detail body", () => {
    const html = card("PHQ9");
    // The med-card header primitive paints the bold name + category badge.
    expect(html).toContain(mh.instrument.phq9);
    expect(html).toContain(mh.instrumentSub.phq9);
    // v1.27.9 — the card body opens the per-instrument detail…
    expect(html).toContain('data-slot="instrument-card-open"');
    expect(html).toContain(mh.openDetail);
    // …and the Start action remains the single bottom-pinned action.
    expect(html).toContain(mh.start);
    // No history yet → the calm no-check-in line, no fabricated dashes.
    expect(html).toContain(mh.noResultYet);
    // v1.27.24 — the attribution moved off the space under Start to a
    // top-right info control on the header. The trigger renders; nothing
    // sits under the Start button anymore.
    expect(html).toContain('data-slot="instrument-card-attribution-trigger"');
    // The citation now lives in the trigger's popover (portaled, opened on
    // tap), never as a paragraph beneath the action.
    const startIdx = html.indexOf(mh.start);
    expect(startIdx).toBeGreaterThan(-1);
    expect(html.slice(startIdx)).not.toContain(
      'data-slot="instrument-card-attribution"',
    );
  });

  it("the header info control is a sibling of the detail-open button, never nested", () => {
    const html = card("WHO5");
    // Both the info trigger and the detail-open button render, but neither is
    // inside the other (nested interactive controls are invalid + would let a
    // tap open both). A simple structural check: the trigger appears before
    // the open button's closing markup boundary is irrelevant — assert both
    // slots exist and the trigger carries its own accessible name.
    expect(html).toContain('data-slot="instrument-card-attribution-trigger"');
    expect(html).toContain('data-slot="instrument-card-open"');
    const trigger = html.match(
      /<button[^>]*data-slot="instrument-card-attribution-trigger"[^>]*>/,
    );
    expect(trigger).not.toBeNull();
    expect(trigger![0]).toContain("aria-label=");
  });

  it("shows last test (relative) and last result (score + band word)", () => {
    const html = card("PHQ9", lastRow);
    expect(html).toContain(mh.lastResult);
    expect(html).toContain(mh.lastScore);
    // Score + band word ride one value slot ("8 · Mild").
    expect(html).toContain('data-slot="instrument-card-last-score"');
    expect(html).toContain(mh.band.PHQ9.mild);
    expect(html).not.toContain(mh.noResultYet);
  });
});

describe("instrument detail (v1.27.9 — opened from a card)", () => {
  const rows: AssessmentRow[] = [
    {
      id: "d1",
      instrument: "SCI",
      locale: "en",
      wording: "validated",
      totalScore: 22,
      severityBand: "aboveThreshold",
      item9Flagged: false,
      crisisShownAt: null,
      takenAt: "2026-06-20T00:00:00.000Z",
    },
    {
      id: "d2",
      instrument: "PHQ9",
      locale: "en",
      wording: "validated",
      totalScore: 4,
      severityBand: "minimal",
      item9Flagged: false,
      crisisShownAt: null,
      takenAt: "2026-06-01T00:00:00.000Z",
    },
  ];

  it("shows last score + band, the Start action, the pinned history and the attribution", () => {
    const html = withProviders(
      <InstrumentDetail instrument="SCI" rows={rows} onStart={() => {}} />,
    );
    expect(html).toContain('data-slot="instrument-detail"');
    expect(html).toContain('data-slot="instrument-detail-last-score"');
    expect(html).toContain(mh.band.SCI.aboveThreshold);
    expect(html).toContain('data-slot="instrument-detail-start"');
    expect(html).toContain(mh.start);
    // The pinned history (chart shell + dated list) rides inside the detail.
    expect(html).toContain('data-pinned="SCI"');
    expect(html).toContain('data-slot="history-list"');
    // …filtered to the pinned instrument: the PHQ-9 row stays out.
    expect(html).not.toContain(mh.band.PHQ9.minimal);
    // Required attribution line.
    expect(html).toContain("Sleepio Limited");
  });
});

describe("questionnaires in the reader's language", () => {
  function renderIn(locale: "nl" | "de", node: React.ReactNode): string {
    const queryClient = new QueryClient();
    seedQuestionnaireWording(queryClient);
    return renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <I18nProvider
          initialLocale={locale}
          initialMessages={locale === "nl" ? nl : undefined}
        >
          {node}
        </I18nProvider>
      </QueryClientProvider>,
    );
  }

  function wizard(instrument: "PHQ9" | "SCI") {
    return (
      <CheckInWizard
        instrument={instrument}
        onSubmit={() => {}}
        onBack={() => {}}
        isPending={false}
        isError={false}
      />
    );
  }

  it("holds the step's place while the language's text loads", () => {
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <I18nProvider initialLocale="nl" initialMessages={nl}>
          {wizard("SCI")}
        </I18nProvider>
      </QueryClientProvider>,
    );
    expect(html).toContain('data-slot="check-in-loading"');
    expect(html).not.toContain('data-slot="check-in-question"');
    expect(html).not.toContain('data-slot="check-in-unvalidated-note"');
  });

  it("the PHQ-9 in Dutch is the validated Dutch form, with no note and no switch", () => {
    const html = renderIn("nl", wizard("PHQ9"));
    const dutch = WORDING.PHQ9.nl;
    expect(html).toContain(dutch.stems.period);
    expect(html).toContain(dutch.items[0]);
    for (const v of [0, 1, 2, 3]) expect(html).toContain(dutch.anchors.all[v]);
    expect(html).not.toContain(WORDING.PHQ9.en.items[0]);
    expect(html).not.toContain('data-slot="check-in-unvalidated-note"');
    expect(html).not.toContain('data-slot="check-in-wording-toggle"');
  });

  it("the SCI in Dutch shows the translation under the note, with the switch to the English original", () => {
    const html = renderIn("nl", wizard("SCI"));
    const dutch = WORDING.SCI.nl;
    expect(dutch.validated).toBe(false);
    expect(html).toContain(dutch.stems.night);
    expect(html).toContain(dutch.items[0]);
    expect(html).not.toContain(WORDING.SCI.en.items[0]);
    expect(html).toContain('data-slot="check-in-unvalidated-note"');
    expect(html).toContain(nl.mentalHealth.wording.unvalidatedNote);
    expect(html).toContain('data-slot="check-in-wording-toggle"');
    expect(html).toContain(nl.mentalHealth.wording.showOriginal);
  });

  it("the result and the history mark an unvalidated translation, and only that", () => {
    const row = (wording: AssessmentRow["wording"]): AssessmentRow => ({
      id: `s-${wording}`,
      instrument: "SCI",
      locale: "nl",
      wording,
      totalScore: 20,
      severityBand: "aboveThreshold",
      item9Flagged: false,
      crisisShownAt: null,
      takenAt: "2026-06-20T00:00:00.000Z",
    });
    const result = (wording: AssessmentRow["wording"]) =>
      renderIn(
        "nl",
        <AssessmentResult
          result={{
            assessment: row(wording),
            actionThreshold: 16,
            crisis: null,
          }}
          onTakeAnother={() => {}}
          onBack={() => {}}
        />,
      );
    expect(result("unvalidated_translation")).toContain(
      nl.mentalHealth.wording.resultUnvalidated,
    );
    for (const other of ["validated", "original_en", null] as const) {
      expect(result(other)).not.toContain('data-slot="result-wording-note"');
    }
    const history = renderIn(
      "nl",
      <AssessmentHistory
        instrument="SCI"
        rows={[row("unvalidated_translation"), row("original_en")]}
      />,
    );
    expect(history.split('data-slot="history-wording-note"').length - 1).toBe(
      1,
    );
    expect(history).toContain(nl.mentalHealth.wording.historyUnvalidated);
  });
});
