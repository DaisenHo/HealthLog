/**
 * Drug-level chart tests.
 *
 * The estimated drug-level curve is visible by default for any
 * recognised GLP-1 brand — it does NOT require Research Mode. The
 * decision tree is now:
 *   - the medication's brand resolves to a Glp1DrugId → render, ELSE
 *     the unknown-drug placeholder.
 *   - no intake events → empty state.
 *   - otherwise → the AreaChart, always with the pharmacokinetic
 *     estimate disclaimer attached.
 *
 * Recharts in `renderToStaticMarkup` only paints the static frame (the
 * `<ResponsiveContainer>` mounts but doesn't measure), so we assert on
 * `data-slot="drug-level-chart-area"` presence + the gradient
 * definition + the y-axis having no `<text>` tick labels.
 *
 * Pure helpers (`parseDoseMg`, `resolveDoseMg`) get their own unit
 * coverage — they're tested directly so the data-shape transformation
 * stays correct without a Recharts mount.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";

// Capture queryKey routing so different tests can stub different
// query results. The component reads two queries:
//   - ["medications", id, "glp1-details"]
//   - ["medications", id, "intake", "drug-level-chart"]
const queryResults: Record<string, unknown> = {};

function setQueryResult(keyJoined: string, data: unknown) {
  queryResults[keyJoined] = data;
}

vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    const key = (queryKey as Array<string | number>).join("/");
    return {
      data: queryResults[key],
      isLoading: false,
    };
  },
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// Pin the PK compute helper so we can assert "the chart asked for the
// right doses" without re-running the math.
const pkCalls: Array<{
  drug: string;
  doses: Array<{ takenAt: Date; doseMg: number }>;
  asOf: Date;
}> = [];

vi.mock("@/lib/medications/glp1-pk", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/medications/glp1-pk")
  >("@/lib/medications/glp1-pk");
  return {
    ...actual,
    computeOneCompartment: (
      drug: string,
      doses: Array<{ takenAt: Date; doseMg: number }>,
      asOf: Date,
    ) => {
      pkCalls.push({ drug, doses, asOf });
      // Return a small fixed series so the chart renders a non-empty
      // SVG path. Two samples is enough to verify the Area renders.
      return [
        { tHours: -24 * 21, concentration: 0 },
        { tHours: -24 * 14, concentration: 0.6 },
        { tHours: -24 * 7, concentration: 1.0 },
        { tHours: 0, concentration: 0.7 },
      ];
    },
  };
});

import {
  DrugLevelChart,
  loadTakenIntakesSince,
  parseDoseMg,
  resolveDoseMg,
} from "../drug-level-chart";

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const mounjaro = {
  id: "med-1",
  name: "Mounjaro",
  dose: "7.5 mg",
};

const ramipril = {
  id: "med-2",
  name: "Ramipril",
  dose: "5 mg",
};

beforeEach(() => {
  for (const k of Object.keys(queryResults)) delete queryResults[k];
  pkCalls.length = 0;
});

describe("<DrugLevelChart> — default-on decision tree", () => {
  it("renders the unknown-drug placeholder for a non-GLP-1 brand", () => {
    const html = render(<DrugLevelChart medication={ramipril} />);

    expect(html).toContain('data-slot="drug-level-chart-unknown-drug"');
    expect(html).toContain("Ramipril");
    // Chart body must not paint when the drug is unknown.
    expect(html).not.toContain('data-slot="drug-level-chart-area"');
    // The PK helper is never asked to compute for an unknown drug.
    expect(pkCalls).toHaveLength(0);
  });

  it("renders the chart for a GLP-1 med WITHOUT any Research Mode opt-in", () => {
    // No research-mode query is stubbed at all — the chart must still
    // render the curve for a recognised GLP-1 brand.
    setQueryResult("medications/med-1/glp1-details", {
      doseChanges: [
        {
          id: "dc-1",
          effectiveFrom: "2026-04-01T00:00:00Z",
          doseValue: 7.5,
          doseUnit: "mg",
        },
      ],
    });
    setQueryResult("medications/med-1/intake/drug-level-chart", {
      events: [
        {
          id: "ev-1",
          takenAt: "2026-05-13T08:00:00Z",
          skipped: false,
          scheduledFor: "2026-05-13T08:00:00Z",
        },
      ],
    });

    const html = render(
      <DrugLevelChart
        medication={mounjaro}
        asOf={new Date("2026-05-14T12:00:00Z")}
      />,
    );

    expect(html).toContain('data-slot="drug-level-chart-area"');
    // The gated placeholder must never appear now.
    expect(html).not.toContain('data-slot="drug-level-chart-gated"');
    // The estimate disclaimer is always attached.
    expect(html).toContain('data-slot="drug-level-chart-disclaimer"');
    expect(pkCalls).toHaveLength(1);
  });

  it("renders the empty state when no intake events exist", () => {
    setQueryResult("medications/med-1/glp1-details", { doseChanges: [] });
    setQueryResult("medications/med-1/intake/drug-level-chart", {
      events: [],
    });

    const html = render(<DrugLevelChart medication={mounjaro} />);

    expect(html).toContain('data-slot="drug-level-chart-empty"');
    expect(html).toContain("No intake events yet");
    expect(html).not.toContain('data-slot="drug-level-chart-area"');
    // The estimate disclaimer stays attached even without data.
    expect(html).toContain('data-slot="drug-level-chart-disclaimer"');
    expect(pkCalls).toHaveLength(0);
  });

  it("falls back to the headline dose when no dose-change rows exist", () => {
    // No doseChanges rows — every intake resolves to the headline
    // "7.5 mg" dose so the curve still renders for a typical med.
    setQueryResult("medications/med-1/glp1-details", { doseChanges: [] });
    setQueryResult("medications/med-1/intake/drug-level-chart", {
      events: [
        {
          id: "ev-1",
          takenAt: "2026-05-13T08:00:00Z",
          skipped: false,
          scheduledFor: "2026-05-13T08:00:00Z",
        },
      ],
    });

    const html = render(
      <DrugLevelChart
        medication={mounjaro}
        asOf={new Date("2026-05-14T12:00:00Z")}
      />,
    );

    expect(html).toContain('data-slot="drug-level-chart-area"');
    expect(pkCalls).toHaveLength(1);
    const [call] = pkCalls;
    expect(call.doses).toHaveLength(1);
    expect(call.doses.every((d) => d.doseMg === 7.5)).toBe(true);
  });

  it("renders the chart when intake events exist", () => {
    setQueryResult("medications/med-1/glp1-details", {
      doseChanges: [
        {
          id: "dc-1",
          effectiveFrom: "2026-04-01T00:00:00Z",
          doseValue: 7.5,
          doseUnit: "mg",
        },
      ],
    });
    setQueryResult("medications/med-1/intake/drug-level-chart", {
      events: [
        {
          id: "ev-1",
          takenAt: "2026-05-13T08:00:00Z",
          skipped: false,
          scheduledFor: "2026-05-13T08:00:00Z",
        },
        {
          id: "ev-2",
          takenAt: "2026-05-06T08:00:00Z",
          skipped: false,
          scheduledFor: "2026-05-06T08:00:00Z",
        },
        // A skipped event must NOT contribute to the curve.
        {
          id: "ev-3",
          takenAt: null,
          skipped: true,
          scheduledFor: "2026-04-29T08:00:00Z",
        },
      ],
    });

    const fixedNow = new Date("2026-05-14T12:00:00Z");
    const html = render(
      <DrugLevelChart medication={mounjaro} asOf={fixedNow} />,
    );

    expect(html).toContain('data-slot="drug-level-chart-area"');
    expect(html).toContain("Estimated drug level");
    // The estimate disclaimer must accompany the chart body.
    expect(html).toContain('data-slot="drug-level-chart-disclaimer"');

    // The PK helper was asked for the right drug, with only the two
    // non-skipped doses, and with the supplied `asOf`.
    expect(pkCalls).toHaveLength(1);
    const [call] = pkCalls;
    expect(call.drug).toBe("tirzepatide");
    expect(call.doses).toHaveLength(2);
    expect(call.doses.every((d) => d.doseMg === 7.5)).toBe(true);
    expect(call.asOf).toEqual(fixedNow);
  });

  it("wraps the chart inside the canonical MedicationDetailSection chrome (UI-H1)", () => {
    // The standalone mount on `/medications/[id]/history` lifts onto the
    // shared `<MedicationDetailSection>` chrome alongside Titration /
    // Scheduling / SideEffects. The aria-labelledby thread + the
    // `border-border/60 rounded-md border` shell are the
    // load-bearing seams.
    const html = render(<DrugLevelChart medication={mounjaro} />);
    expect(html).toContain('data-slot="drug-level-chart"');
    expect(html).toContain('aria-labelledby="drug-level-chart-title"');
    expect(html).toContain("border-border/60");
    expect(html).toContain("rounded-md");
    // No more standalone `<header>` block on the chart — the section
    // header band owns the heading scale now.
    expect(html).not.toContain("text-dracula-purple h-4 w-4");
  });

  it("hides the y-axis tick labels (research §2.3, unit-less)", () => {
    setQueryResult("medications/med-1/glp1-details", { doseChanges: [] });
    setQueryResult("medications/med-1/intake/drug-level-chart", {
      events: [
        {
          id: "ev-1",
          takenAt: "2026-05-13T08:00:00Z",
          skipped: false,
          scheduledFor: "2026-05-13T08:00:00Z",
        },
      ],
    });

    const html = render(
      <DrugLevelChart
        medication={mounjaro}
        asOf={new Date("2026-05-14T12:00:00Z")}
      />,
    );

    // Recharts paints `<text class="recharts-cartesian-axis-tick-value">`
    // for each numeric tick. The drug-level chart suppresses those for
    // the Y axis by passing `tick={false}` — none should appear inside
    // the y-axis container. Same content scan that the dashboard chart
    // tests already use.
    const yAxisTickValues = html.match(
      /class="recharts-yAxis.*?recharts-cartesian-axis-tick-value/g,
    );
    expect(yAxisTickValues).toBeNull();

    // The unit-less axis label still renders (it carries the
    // educational framing).
    expect(html).toContain("Estimated level (relative)");
  });
});

describe("parseDoseMg / resolveDoseMg helpers", () => {
  it("parses standard '7.5 mg' / '12,5 mg' / '0.25 mg' shapes", () => {
    expect(parseDoseMg("7.5 mg")).toBe(7.5);
    expect(parseDoseMg("12,5 mg")).toBe(12.5);
    expect(parseDoseMg("0.25 mg")).toBe(0.25);
    expect(parseDoseMg("15 mg")).toBe(15);
  });

  it("returns NaN for non-numeric strings", () => {
    expect(Number.isNaN(parseDoseMg(""))).toBe(true);
    expect(Number.isNaN(parseDoseMg("as needed"))).toBe(true);
  });

  it("resolves the dose to the latest effectiveFrom <= takenAt", () => {
    const history = [
      {
        id: "a",
        effectiveFrom: "2026-01-01T00:00:00Z",
        doseValue: 2.5,
        doseUnit: "mg",
      },
      {
        id: "b",
        effectiveFrom: "2026-03-01T00:00:00Z",
        doseValue: 5,
        doseUnit: "mg",
      },
      {
        id: "c",
        effectiveFrom: "2026-05-01T00:00:00Z",
        doseValue: 7.5,
        doseUnit: "mg",
      },
    ];

    // Before any history → fallback.
    expect(resolveDoseMg("2025-12-15T00:00:00Z", history, 1)).toBe(1);
    // Inside the 2.5-mg window.
    expect(resolveDoseMg("2026-02-15T00:00:00Z", history, 1)).toBe(2.5);
    // On the 5-mg boundary day.
    expect(resolveDoseMg("2026-03-01T00:00:00Z", history, 1)).toBe(5);
    // Inside the 5-mg window.
    expect(resolveDoseMg("2026-04-15T00:00:00Z", history, 1)).toBe(5);
    // Inside the latest window.
    expect(resolveDoseMg("2026-05-10T00:00:00Z", history, 1)).toBe(7.5);
  });

  it("returns the fallback when takenAt is unparseable", () => {
    expect(resolveDoseMg("not-an-iso", [], 42)).toBe(42);
  });
});

describe("loadTakenIntakesSince", () => {
  const DAY = 24 * 60 * 60 * 1000;
  // 400 daily taken doses, newest first, the newest one a day ago.
  const now = Date.parse("2026-06-01T08:00:00.000Z");
  const all = Array.from({ length: 400 }, (_, i) => ({
    id: `i-${i}`,
    takenAt: new Date(now - (i + 1) * DAY).toISOString(),
    skipped: false,
    scheduledFor: new Date(now - (i + 1) * DAY).toISOString(),
  }));

  function pager() {
    const urls: string[] = [];
    const fetchPage = async (url: string) => {
      urls.push(url);
      const params = new URL(url, "http://localhost").searchParams;
      const limit = Number(params.get("limit"));
      const offset = Number(params.get("offset"));
      return {
        events: all.slice(offset, offset + limit),
        meta: { total: all.length },
      };
    };
    return { urls, fetchPage };
  }

  it("walks back past a single page to the horizon, and no further", async () => {
    const { urls, fetchPage } = pager();
    // 21-day window + 5 half-lives of 7 days = 56 days, then 150 to cross a page.
    const since = new Date(now - 150.5 * DAY);
    const { events } = await loadTakenIntakesSince("med-1", since, fetchPage);
    expect(events).toHaveLength(150);
    expect(urls).toHaveLength(2);
    for (const url of urls) {
      expect(url).toContain("status=taken");
      expect(url).toContain("sortBy=takenAt");
    }
  });

  it("stops at the end of the history", async () => {
    const { urls, fetchPage } = pager();
    const { events } = await loadTakenIntakesSince(
      "med-1",
      new Date(now - 10_000 * DAY),
      fetchPage,
    );
    expect(events).toHaveLength(400);
    expect(urls).toHaveLength(4);
  });
});
