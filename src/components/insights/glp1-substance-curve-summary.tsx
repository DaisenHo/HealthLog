"use client";

/**
 * v1.28.20 — compact GLP-1 estimated active-substance curve for the Insights
 * medication surface. Additive to the medication detail page's Injektion and
 * Wirkung tabs: the same self-contained `DrugLevelChart` (modelled
 * one-compartment level from the user's logged intakes + dose changes),
 * surfaced where the compliance overview already lives.
 *
 * Gating: reads `GET /api/insights/glp1-timeline` — the server-authoritative
 * GLP-1 signal. When `hasGlp1` is false the block renders nothing. The set of
 * GLP-1 medications comes from the response's `medications` list, which the
 * server fills from every `treatmentClass === "GLP1"` medication independent
 * of the entry cap, and the passed medication list is filtered to that set so
 * non-GLP-1 medications never render a curve. (It used to be derived from the
 * names in a capped page of entries, which dropped a medication whose events
 * were all older than that page.)
 *
 * The chart carries its own `MedicationDetailSection` card chrome + estimate
 * disclaimer, so it reads as one system with the surrounding Insights cards
 * without a second computation. Recharts loads through `next/dynamic`
 * (client-only) to stay out of the page's initial bundle.
 */
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";

import { ChartSkeleton } from "@/components/charts/chart-skeleton";
import { Glp1PlateauNote } from "@/components/insights/glp1-plateau-note";
import { queryKeys } from "@/lib/query-keys";
import { apiGet } from "@/lib/api/api-fetch";

const DrugLevelChart = dynamic(
  () =>
    import("@/components/charts/chart-runtime").then((mod) => ({
      default: mod.DrugLevelChart,
    })),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

interface Glp1TimelineResponse {
  hasGlp1: boolean;
  medications: { id: string; name: string }[];
}

export function Glp1SubstanceCurveSummary({
  medications,
}: {
  medications: { id: string; name: string; dose: string }[];
}) {
  const { data } = useQuery({
    // Only `medications` is read, so the smallest page of entries will do.
    queryKey: queryKeys.insightsGlp1Timeline(1),
    queryFn: () =>
      apiGet<Glp1TimelineResponse>("/api/insights/glp1-timeline?limit=1"),
    staleTime: 60_000,
  });

  if (!data?.hasGlp1) return null;

  const glp1Ids = new Set(data.medications.map((m) => m.id));
  const glp1Meds = medications.filter((m) => glp1Ids.has(m.id));
  if (glp1Meds.length === 0) return null;

  const showNameLabel = glp1Meds.length > 1;

  return (
    <div className="space-y-4" data-slot="insights-glp1-substance-curve">
      {glp1Meds.map((med) => (
        <div key={med.id} className="space-y-2">
          {showNameLabel ? (
            <p className="text-muted-foreground px-1 text-xs font-medium">
              {med.name}
            </p>
          ) : null}
          <DrugLevelChart
            medication={{ id: med.id, name: med.name, dose: med.dose }}
          />
        </div>
      ))}
      {/* v1.28.21 — weight-plateau note (association only), below the
          curve(s). Self-gating: renders nothing unless the server-side
          detector reports a plateau on the current dose. */}
      <Glp1PlateauNote />
    </div>
  );
}
