"use client";

import { ShieldCheck } from "lucide-react";

import { useInsightsAnalytics } from "@/hooks/use-insights-analytics";
import { useTranslations } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LearningGate } from "@/components/ui/learning-gate";
import { LearnMoreLink } from "@/components/ui/learn-more-link";
import { TileHeader } from "@/components/insights/tile-header";

/**
 * v1.19.2 — calm readout for Oura's daily resilience level.
 *
 * v1.19.0 ingests `daily_resilience.level` end-to-end as the `RESILIENCE`
 * MeasurementType, ordinal-encoded into the numeric value (limited=1 …
 * exceptional=5; see `RESILIENCE_LEVELS` in `src/lib/oura/client`). The data
 * landed but no surface rendered it; this tile is that surface.
 *
 * Resilience is a categorical band, not a continuous score, so the generic
 * chart block would paint a misleading line over five discrete steps. Instead
 * this tile reads the stored latest ordinal, names its band, and gives a calm
 * one-line description plus a quiet "vs the recent average" cue. It is
 * server-authoritative throughout — it reads the shared
 * `["analytics", "summaries"]` slice (`latest` + `mean`, both computed
 * server-side) and never re-derives the value.
 *
 * Calm posture (the maintainer's standing card rule): one neutral card, no
 * green-when-good / red-when-low tint, no alarming chrome. The band label and
 * the trend cue carry the read in muted text only.
 *
 * Self-gating: renders nothing when the metric has no readings, so a
 * non-Oura account stays byte-identical. When the series is present but still
 * sparse it shows the shared `<LearningGate>` rather than a one-off trend.
 */

/** Min readings before the "vs recent average" cue is shown. */
const MIN_TREND_READINGS = 3;

/**
 * The ordinal → static i18n key, in lock-step with `RESILIENCE_LEVELS`
 * (limited=1 … exceptional=5). Index 0 is unused so the ordinal indexes
 * directly. The keys are written out in full (not `band.${ordinal}`) so the
 * i18n call-site coverage guard verifies every one resolves. The band
 * vocabulary is Oura's own — not invented here.
 */
const BAND_KEYS = [
  null,
  "insights.resilience.band.limited",
  "insights.resilience.band.adequate",
  "insights.resilience.band.solid",
  "insights.resilience.band.strong",
  "insights.resilience.band.exceptional",
] as const;

/** Static trend keys, written out so the i18n coverage guard resolves them. */
const TREND_KEYS = {
  above: "insights.resilience.trend.above",
  steady: "insights.resilience.trend.steady",
  below: "insights.resilience.trend.below",
} as const;

export function ResilienceTile() {
  const { t } = useTranslations();
  const { data } = useInsightsAnalytics("SLEEP_DURATION");
  const summary = data?.summaries?.["RESILIENCE"];

  const count = summary?.count ?? 0;
  if (count === 0) return null;

  const latest = summary?.latest ?? null;
  const mean = summary?.mean ?? null;
  // The ordinal lands as a number; clamp into the known 1–5 band range so a
  // future Oura level the ingest does not yet recognise can never index out
  // of the label table (ingest already drops unknown levels, this is belt).
  const ordinal =
    latest != null ? Math.min(5, Math.max(1, Math.round(latest))) : null;
  const bandKey = ordinal != null ? BAND_KEYS[ordinal] : null;

  // Quiet trend: today's level against the rounded trailing-window mean. Calm
  // wording (above / steady / below the recent average), never a colour. Both
  // operands are server-computed; nothing is recomputed from raw rows here.
  let trendKey: "above" | "steady" | "below" | null = null;
  if (count >= MIN_TREND_READINGS && ordinal != null && mean != null) {
    const meanOrdinal = Math.round(mean);
    if (ordinal > meanOrdinal) trendKey = "above";
    else if (ordinal < meanOrdinal) trendKey = "below";
    else trendKey = "steady";
  }

  return (
    <Card data-slot="resilience-tile" data-metric="RESILIENCE">
      <CardHeader>
        {/* Canonical compact tile header — foreground `h-4` icon + `text-sm`
            title; the current band rides the `right` slot. */}
        <TileHeader
          size="sm"
          icon={ShieldCheck}
          title={t("measurements.typeResilience")}
          reserveLines={2}
          className="min-w-0"
          right={
            bandKey != null ? (
              <span
                data-slot="resilience-band"
                className="text-foreground text-lg font-semibold"
              >
                {t(bandKey)}
              </span>
            ) : undefined
          }
        />
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-foreground text-sm leading-relaxed">
          {t("insights.resilience.explainer")}
        </p>
        {count < MIN_TREND_READINGS ? (
          <LearningGate
            compact
            bodySlot="resilience-learning"
            message={t("insights.resilience.learning")}
          />
        ) : trendKey != null ? (
          <p
            data-slot="resilience-trend"
            className="text-muted-foreground text-xs"
          >
            {t(TREND_KEYS[trendKey])}
          </p>
        ) : null}
        <LearnMoreLink concept="RESILIENCE" />
      </CardContent>
    </Card>
  );
}
