/**
 * `<SourceProvenanceView>` draws the server's answer (SSR markup): the day's
 * sources with the used one marked and the reason in words, the person's
 * ladder, and the side-by-side table with the used value in bold. The link
 * from a metric page appears only for a metric the ladder decides for.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";

const state: { day: unknown; compare: unknown } = {
  day: undefined,
  compare: undefined,
};

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/use-source-provenance", () => ({
  useDayProvenance: () => ({
    data: state.day,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSourceComparison: () => ({
    data: state.compare,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { SourceProvenanceView } from "../source-provenance-view";
import { SourceProvenanceLink } from "../source-provenance-link";

function render(node: React.ReactElement) {
  return renderToStaticMarkup(
    <I18nProvider initialLocale="en">{node}</I18nProvider>,
  );
}

const DAY = {
  type: "SLEEP_DURATION",
  date: "2026-10-01",
  aggregation: "sum",
  ranked: true,
  metricKey: "sleep",
  ladder: ["WHOOP", "OURA"],
  picked: "WHOOP",
  pickReason: "highest_on_ladder",
  sources: [
    {
      source: "WHOOP",
      rank: 0,
      readings: 1,
      value: 420,
      min: 420,
      max: 420,
      firstAt: "",
      lastAt: "",
      unit: "min",
      devices: ["band"],
      pass: null,
    },
    {
      source: "OURA",
      rank: 1,
      readings: 3,
      value: 391,
      min: 30,
      max: 301,
      firstAt: "",
      lastAt: "",
      unit: "min",
      devices: ["ring"],
      pass: "lower_on_ladder",
    },
  ],
};

const COMPARE = {
  type: "SLEEP_DURATION",
  from: "2026-09-02",
  to: "2026-10-01",
  aggregation: "sum",
  ranked: true,
  ladder: ["WHOOP", "OURA"],
  unit: "min",
  sources: [
    { source: "OURA", days: 30 },
    { source: "WHOOP", days: 20 },
  ],
  a: "OURA",
  b: "WHOOP",
  days: [{ date: "2026-10-01", a: 391, b: 420, picked: "WHOOP" }],
  summary: {
    daysA: 30,
    daysB: 20,
    daysBoth: 20,
    meanA: 395,
    meanB: 440,
    meanDifference: 45,
    meanAbsoluteDifference: 45,
    pickedA: 10,
    pickedB: 20,
  },
};

describe("SourceProvenanceView", () => {
  it("names the used source, why, and why the other was not used", () => {
    state.day = DAY;
    state.compare = COMPARE;
    const html = render(
      <SourceProvenanceView
        initialType="SLEEP_DURATION"
        initialDate="2026-10-01"
      />,
    );
    expect(html).toContain('data-source="WHOOP" data-picked="true"');
    expect(html).toContain('data-source="OURA" data-picked="false"');
    expect(html).toContain("stands highest in your source priority");
    expect(html).toContain("Lower in your source priority.");
    expect(html).toContain("Your order for this metric: WHOOP, Oura");
    expect(html).toContain('href="/settings/sources"');
  });

  it("lines up two sources and marks the used value", () => {
    state.day = DAY;
    state.compare = COMPARE;
    const html = render(
      <SourceProvenanceView
        initialType="SLEEP_DURATION"
        initialDate="2026-10-01"
      />,
    );
    expect(html).toContain('data-slot="provenance-compare-row"');
    expect(html).toMatch(/font-semibold tabular-nums">420/);
    expect(html).toContain("10 / 20");
  });

  it("says when there is nothing to compare", () => {
    state.day = { ...DAY, sources: [], picked: null, pickReason: null };
    state.compare = {
      ...COMPARE,
      sources: [{ source: "OURA", days: 3 }],
      b: null,
    };
    const html = render(
      <SourceProvenanceView initialType="SLEEP_DURATION" initialDate={null} />,
    );
    expect(html).toContain('data-slot="provenance-day-empty"');
    expect(html).toContain('data-slot="provenance-compare-empty"');
  });

  it("labels the range with the charts' short day labels and spells them out", () => {
    state.day = DAY;
    state.compare = COMPARE;
    const html = render(
      <SourceProvenanceView initialType="SLEEP_DURATION" initialDate={null} />,
    );
    for (const days of ["30", "90", "365"]) {
      expect(html).toMatch(
        new RegExp(
          `data-slot="provenance-range-${days}"[^>]*title="${days} days"[^>]*>${days}d<|title="${days} days"[^>]*data-slot="provenance-range-${days}"[^>]*>${days}d<`,
        ),
      );
    }
  });
});

describe("SourceProvenanceLink", () => {
  it("links ranked metrics and stays away from the rest", () => {
    expect(render(<SourceProvenanceLink type="ACTIVITY_STEPS" />)).toContain(
      "/insights/sources?type=ACTIVITY_STEPS",
    );
    expect(render(<SourceProvenanceLink type="BLOOD_GLUCOSE" />)).toBe("");
  });
});
