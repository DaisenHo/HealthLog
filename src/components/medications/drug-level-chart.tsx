"use client";

/**
 * Estimated drug-level chart for GLP-1 medications. Visible by default
 * for any recognised GLP-1 drug — the curve is the modelled
 * active-ingredient level the medication concerns. The y-axis paints
 * "Estimated level (relative)" without tick labels and the persistent
 * estimate disclaimer makes the pharmacokinetic-ESTIMATE framing
 * explicit: this is a modelled value, not a measured blood
 * concentration.
 *
 * Inputs (read-only):
 *   - Drug id resolved from the medication name (catalog lookup via
 *     `findDrugByBrand`); falls back to a gated message when the
 *     medication isn't in the GLP-1 catalog.
 *   - Intake events from `GET /api/medications/[id]/intake` — only
 *     non-skipped events with a `takenAt` contribute.
 *   - Dose history from `GET /api/medications/[id]/glp1` (the
 *     `doseChanges` slice). Each intake event is matched to its
 *     applicable dose by walking the dose-change timeline; intakes
 *     that pre-date every dose-change row fall back to the
 *     medication's headline dose string.
 *
 * Pure math: `computeOneCompartment(drug, doses, asOf)` from
 * `glp1-pk.ts`. The chart renders a 21-day window so three weekly
 * cycles are visible, anchored at "now". Mobile-first ResponsiveContainer,
 * Dracula tokens that match the rest of the chart suite.
 *
 * v1.4.28 — the dashboard tile that consumed the compact rendering
 * branch retired with FB-A2. The standalone `/medications/[id]/history`
 * page is the sole mount; the chart now lifts onto the canonical
 * `<MedicationDetailSection>` chrome alongside Titration / Scheduling /
 * SideEffects (UI-H1). The `compact` prop + `windowHoursBefore` override
 * dropped with the tile.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Syringe } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useTranslations } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import { apiGet } from "@/lib/api/api-fetch";
import {
  computeOneCompartment,
  type DoseEvent,
} from "@/lib/medications/glp1-pk";
import {
  findDrugIdByBrand,
  GLP1_DRUGS,
  type Glp1DrugId,
} from "@/lib/medications/glp1-knowledge";
import { parseDoseMg } from "@/lib/medications/dose-string";
import { prefersReducedMotion } from "@/lib/charts/reduced-motion";
import { MedicationDetailSection } from "@/components/medications/medication-detail-section";

// --chart-1 is the light/dark-aware alias for this hue (dracula-purple in
// dark mode); raw --dracula-purple has no light-theme override and mis-
// renders on the light card.
const CHART_COLOR = "var(--chart-1)";
const CHART_FILL_OPACITY = 0.18;
const HOURS_PER_DAY = 24;
/** 21 days back, 0 days forward — three weekly cycles of history with
 *  "now" at the right edge. Matches research §2.4's recommendation
 *  for a research-view chart that emphasises the sawtooth shape. */
const WINDOW_HOURS_BEFORE = 21 * HOURS_PER_DAY;
const WINDOW_HOURS_AFTER = 0;

/** Taken intakes per request while walking back to the model's horizon. */
const INTAKE_PAGE_SIZE = 100;
/**
 * Half-lives before the chart's left edge whose doses still count. After five
 * half-lives a dose holds about 3% of its peak, below what the chart can show.
 */
const HORIZON_HALF_LIVES = 5;

/**
 * Every taken intake from `since` on, newest first, walked page by page. The
 * curve is a sum over every dose still in the body, so a fixed count of
 * recent intakes was wrong in both directions: twenty daily doses of a
 * long-acting drug stop well short of steady state, and planned or skipped
 * rows used up the count without being doses at all.
 */
export async function loadTakenIntakesSince(
  medicationId: string,
  since: Date,
  fetchPage: (url: string) => Promise<{
    events: IntakeEvent[];
    meta: { total: number };
  }> = (url) => apiGet(url),
): Promise<{ events: IntakeEvent[] }> {
  const events: IntakeEvent[] = [];
  for (let offset = 0; ; offset += INTAKE_PAGE_SIZE) {
    const page = await fetchPage(
      `/api/medications/${medicationId}/intake?status=taken&sortBy=takenAt&sortDir=desc&limit=${INTAKE_PAGE_SIZE}&offset=${offset}`,
    );
    events.push(...page.events);
    const oldest = page.events[page.events.length - 1];
    const reachedHorizon =
      !oldest?.takenAt || Date.parse(oldest.takenAt) < since.getTime();
    if (
      reachedHorizon ||
      page.events.length < INTAKE_PAGE_SIZE ||
      offset + INTAKE_PAGE_SIZE >= page.meta.total
    ) {
      break;
    }
  }
  return {
    events: events.filter(
      (ev) => ev.takenAt && Date.parse(ev.takenAt) >= since.getTime(),
    ),
  };
}

interface IntakeEvent {
  id: string;
  takenAt: string | null;
  skipped: boolean;
  scheduledFor: string;
}

interface DoseChange {
  id: string;
  effectiveFrom: string;
  doseValue: number;
  doseUnit: string;
}

interface Glp1DetailsResponse {
  doseChanges: DoseChange[];
}

export interface DrugLevelChartProps {
  /**
   * Medication row (already known to be GLP-1 by the parent — typically
   * because `treatmentClass === "GLP1"`). The component resolves the
   * Glp1DrugId via the brand catalog; if the brand isn't recognised
   * the chart renders an empty-state hint instead of throwing.
   */
  medication: {
    id: string;
    /** Human-readable brand or generic name (e.g. "Mounjaro"). */
    name: string;
    /** Headline dose string ("7.5 mg") used as a fallback when no
     *  per-event dose-change row covers the intake's takenAt. */
    dose: string;
  };
  /**
   * Override "now" for deterministic snapshot tests. Defaults to a
   * fresh `Date()` at render time. The chart re-anchors on every
   * render, but the underlying React Query data keeps the network
   * cost low.
   */
  asOf?: Date;
}

export function DrugLevelChart({ medication, asOf }: DrugLevelChartProps) {
  const { t } = useTranslations();

  // Resolve the catalog key via the shared helper. v1.4.25 W21 Fix-N
  // hoisted `findDrugIdByBrand` so this chart and the titration route
  // share one implementation.
  const drugId: Glp1DrugId | null = useMemo(
    () => findDrugIdByBrand(medication.name),
    [medication.name],
  );

  const { data: details, isLoading: detailsLoading } =
    useQuery<Glp1DetailsResponse | null>({
      queryKey: queryKeys.medicationGlp1Details(medication.id),
      queryFn: async () => {
        try {
          return await apiGet<Glp1DetailsResponse>(
            `/api/medications/${medication.id}/glp1`,
          );
        } catch {
          return null;
        }
      },
      enabled: !!drugId,
      staleTime: 60 * 1000,
    });

  const { data: intakeEnvelope, isLoading: intakeLoading } = useQuery({
    queryKey: queryKeys.medicationIntakeDrugLevelChart(medication.id),
    queryFn: async () => {
      try {
        const halfLifeHours =
          GLP1_DRUGS[drugId!].pharmacology.halfLifeDays * HOURS_PER_DAY;
        const since = new Date(
          Date.now() -
            (WINDOW_HOURS_BEFORE + HORIZON_HALF_LIVES * halfLifeHours) *
              60 *
              60 *
              1000,
        );
        return await loadTakenIntakesSince(medication.id, since);
      } catch {
        return null;
      }
    },
    enabled: !!drugId,
    staleTime: 60 * 1000,
  });

  // Resolve "now" once per render — the asOf override is the only
  // safe way to pin the curve for snapshot tests.
  const now = useMemo(() => asOf ?? new Date(), [asOf]);

  const doses = useMemo<DoseEvent[]>(() => {
    if (!drugId || !intakeEnvelope?.events) return [];
    const dchg = details?.doseChanges ?? [];
    const fallbackMg = parseDoseMg(medication.dose);
    return intakeEnvelope.events
      .filter((ev) => !ev.skipped && ev.takenAt)
      .map((ev) => ({
        takenAt: new Date(ev.takenAt as string),
        doseMg: resolveDoseMg(ev.takenAt as string, dchg, fallbackMg),
      }))
      .filter((d) => Number.isFinite(d.doseMg) && d.doseMg > 0);
  }, [drugId, intakeEnvelope, details, medication.dose]);

  // ── Section header always renders so the parent's "Estimated drug
  //    level" anchor stays stable; the body switches between gated /
  //    loading / empty / chart states.
  const isLoading = !!drugId && (detailsLoading || intakeLoading);
  const hasDoses = doses.length > 0;
  const animationsEnabled = !prefersReducedMotion();
  // Single-window contract — three weekly cycles with the sample step
  // tuned for the AreaChart's point count. The dashboard tile that
  // previously threaded a window-length override retired with FB-A2.
  const stepHours = pickSampleStepHours(WINDOW_HOURS_BEFORE);

  // The chart mounts inside the shared
  // `<MedicationDetailSection>` chrome alongside Titration / Scheduling
  // / SideEffects so the `/medications/[id]/history` page reads on one
  // section recipe. The drug-INN qualifier rides the headerExtras slot
  // on the right edge of the header band.
  const headerExtras = drugId ? (
    <span className="text-muted-foreground text-xs">
      {t(`medications.glp1.drug.${drugId}.name`)}
    </span>
  ) : null;

  // Decision tree:
  //   1. drug not in catalog       → unknown-drug placeholder
  //   2. loading                   → skeleton
  //   3. no intake events          → empty-state with log CTA
  //   4. otherwise                 → AreaChart
  const body = !drugId ? (
    <GatedUnknownDrug medicationName={medication.name} />
  ) : isLoading ? (
    // v1.4.43 — match the loaded chart height (240 px) so the
    // dashboard tile doesn't reflow when the levels render.
    <div
      className="flex h-[240px] min-h-[240px] items-center justify-center"
      data-slot="drug-level-chart-loading"
    >
      <Loader2 className="text-primary h-6 w-6 animate-spin motion-reduce:animate-none" />
    </div>
  ) : !hasDoses ? (
    <EmptyState />
  ) : (
    <ChartBody
      drug={drugId}
      doses={doses}
      asOf={now}
      animationsEnabled={animationsEnabled}
      axisLabel={t("medications.researchMode.chart.axisLabel")}
      stepHours={stepHours}
    />
  );

  return (
    <MedicationDetailSection
      titleId="drug-level-chart-title"
      title={t("medications.researchMode.chart.title")}
      headerExtras={headerExtras}
      dataSlot="drug-level-chart"
    >
      {body}
      {/* The pharmacokinetic-ESTIMATE disclaimer stays attached whenever
          a recognised GLP-1 drug renders the chart — the curve is a
          modelled value, never a measured blood concentration. */}
      {!!drugId && (
        <p
          className="text-foreground/80 border-border bg-muted/40 mt-3 rounded-md border-l-2 px-3 py-2 text-xs font-medium"
          data-slot="drug-level-chart-disclaimer"
        >
          {t("medications.researchMode.chart.estimateNote")}
        </p>
      )}
    </MedicationDetailSection>
  );
}

/**
 * Pick a sample step in hours appropriate for the chosen window
 * length. The default 6 h is fine at ≤ 21 days (≤ 84 samples); longer
 * windows need a coarser grid so the AreaChart stays under a few
 * hundred points. The chart is qualitative (research §2.3) so a coarse
 * step does not change the rising/peak/fading shape.
 */
function pickSampleStepHours(windowHoursBefore: number): number {
  const days = windowHoursBefore / 24;
  if (days <= 21) return 6;
  if (days <= 60) return 12;
  if (days <= 180) return 24;
  return 48;
}

/* ────────────────────────────────────────────────────────────────
 * Body sub-components — pulled out so the tests can pin the gated
 * branches without rendering the Recharts tree (Recharts in SSR is
 * already exercised by the dashboard chart tests).
 * ──────────────────────────────────────────────────────────────── */

function GatedUnknownDrug({ medicationName }: { medicationName: string }) {
  const { t } = useTranslations();
  return (
    <div
      className="text-muted-foreground bg-muted/40 rounded-md p-4 text-sm"
      data-slot="drug-level-chart-unknown-drug"
    >
      <p>
        {t("medications.researchMode.chart.unknownDrug", {
          name: medicationName,
        })}
      </p>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslations();
  return (
    <div
      className="text-muted-foreground bg-muted/40 flex flex-col items-start gap-2 rounded-md p-4 text-sm"
      data-slot="drug-level-chart-empty"
    >
      <div className="flex items-center gap-2">
        <Syringe className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t("medications.researchMode.chart.emptyState")}</p>
      </div>
      <p className="text-xs italic">
        {t("medications.researchMode.chart.emptyStateCta")}
      </p>
    </div>
  );
}

function ChartBody({
  drug,
  doses,
  asOf,
  animationsEnabled,
  axisLabel,
  stepHours,
}: {
  drug: Glp1DrugId;
  doses: readonly DoseEvent[];
  asOf: Date;
  animationsEnabled: boolean;
  /**
   * Y-axis caption — research §2.3 requires "Estimated level (relative)"
   * with NO unit. Rendered both as the Recharts axis label (in the SVG)
   * and as a small visible caption above the chart so screen-reader
   * users and SSR snapshots both surface the framing.
   */
  axisLabel: string;
  /** Sample step in hours; scales with the window length. */
  stepHours: number;
}) {
  const windowDays = WINDOW_HOURS_BEFORE / HOURS_PER_DAY;
  const samples = useMemo(
    () =>
      computeOneCompartment(drug, doses, asOf, {
        windowHoursBefore: WINDOW_HOURS_BEFORE,
        windowHoursAfter: WINDOW_HOURS_AFTER,
        stepHours,
      }),
    [drug, doses, asOf, stepHours],
  );

  // Map samples to chart points. x-axis is "days since now" — negative
  // values for the past window, with 0 = now. Recharts uses the raw
  // domain so categorical day labels don't crowd the visible range.
  const chartData = useMemo(
    () =>
      samples.map((s) => ({
        dayOffset: Math.round((s.tHours / HOURS_PER_DAY) * 10) / 10,
        level: s.concentration,
      })),
    [samples],
  );

  // Pick four x-axis ticks evenly across the window so the strip
  // reads as quarter / midpoint / three-quarter / now regardless of
  // whether the user picked 7d, 30d, 90d, or All.
  const ticks = useMemo(() => {
    const quarter = -Math.round(windowDays * 0.75);
    const midpoint = -Math.round(windowDays * 0.5);
    const lastQuarter = -Math.round(windowDays * 0.25);
    return [-Math.round(windowDays), quarter, midpoint, lastQuarter, 0];
  }, [windowDays]);

  return (
    <>
      <p
        className="text-muted-foreground mb-1 text-xs"
        data-slot="drug-level-chart-axis-caption"
      >
        {axisLabel}
      </p>
      <div
        className="touch-pan-y"
        style={{ height: "240px" }}
        data-slot="drug-level-chart-area"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={chartData}
            margin={{ top: 10, right: 12, bottom: 16, left: 8 }}
          >
            <defs>
              <linearGradient
                id="drug-level-gradient"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={CHART_COLOR}
                  stopOpacity={CHART_FILL_OPACITY * 1.4}
                />
                <stop offset="100%" stopColor={CHART_COLOR} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="var(--border)"
              opacity={0.5}
            />
            {/* v1.4.27 — dropped a stray empty `<text>` child
              that previously declared no content and rendered an
              invisible SVG node beneath the x-axis. */}
            <XAxis
              dataKey="dayOffset"
              type="number"
              domain={[-windowDays, 0]}
              ticks={ticks}
              tickFormatter={(v) => (v === 0 ? "0" : `${v}d`)}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickLine={false}
              axisLine={false}
            />
            {/* Research §2.3 — y-axis is unit-less. We hide tick labels
              and the axis line entirely; the human-readable label sits
              outside the chart frame, above. The `tick={false}` flag
              suppresses the textual ticks per Recharts. v1.4.27 MB6
              The duplicate Recharts `label={…}` prop dropped
              here painted the same caption inside the SVG behind the
              `width={1}` axis, where it could never be read. The
              external `<p>` above the chart is the single source of
              truth for the caption. */}
            <YAxis
              domain={[0, "auto"]}
              tick={false}
              tickLine={false}
              axisLine={false}
              width={1}
            />
            <Tooltip
              content={() => null}
              cursor={{
                stroke: "var(--muted-foreground)",
                strokeOpacity: 0.3,
                strokeDasharray: "3 3",
              }}
            />
            <Area
              type="monotone"
              dataKey="level"
              stroke={CHART_COLOR}
              strokeWidth={2}
              fill="url(#drug-level-gradient)"
              isAnimationActive={animationsEnabled}
              animationDuration={animationsEnabled ? 600 : 0}
              animationEasing="ease-out"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────
 * Pure helpers — dose-mg resolution from the medication's dose
 * string and the dose-change timeline.
 * ──────────────────────────────────────────────────────────────── */

/**
 * Re-export the shared parser so the component-test file
 * (which historically imported `parseDoseMg` from this surface)
 * keeps working without coupling to the helper module path. v1.4.25
 * Single implementation now lives in
 * `src/lib/medications/dose-string.ts`.
 */
export { parseDoseMg };

/**
 * Resolve the dose in mg that applied at `takenAt` by walking the
 * dose-change history. The catalog row with the latest
 * `effectiveFrom ≤ takenAt` wins; intakes before any row fall back
 * to the medication's headline `dose` string.
 *
 * Exported for the unit test.
 */
export function resolveDoseMg(
  takenAtIso: string,
  doseChanges: readonly DoseChange[],
  fallbackMg: number,
): number {
  const takenAtMs = Date.parse(takenAtIso);
  if (!Number.isFinite(takenAtMs)) return fallbackMg;
  let bestValue = fallbackMg;
  let bestStart = -Infinity;
  for (const change of doseChanges) {
    const startMs = Date.parse(change.effectiveFrom);
    if (!Number.isFinite(startMs)) continue;
    if (startMs <= takenAtMs && startMs > bestStart) {
      bestStart = startMs;
      bestValue = change.doseValue;
    }
  }
  return bestValue;
}
