"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { useTranslations } from "@/lib/i18n/context";
import { BackLink } from "@/components/ui/back-link";
import { SubPageShell } from "@/components/insights/sub-page-shell";
import {
  CompositeScoreAnatomy,
  type AnatomyMetricId,
} from "@/components/insights/derived/composite-score-anatomy";

/**
 * v1.10.0 — `/insights/scores/<metric>` — the score-anatomy detail surface.
 *
 * Reached on tap from a score's dashboard / insights entry. Renders the
 * Oura-style anatomy view (big ring + ranked contributor rows where the
 * score decomposes + cited standard + method + honesty caveat) for one
 * derived score — the two composites (sleep, readiness) AND the three
 * persisted nightly scores (recovery, stress, strain), which previously had
 * no detail page. The `[metric]` slug is validated against the known set; an
 * unknown slug falls back to the readiness view's insufficient state rather
 * than 404-ing, so a stale link never dead-ends.
 */

const SLUG_TO_METRIC: Record<string, AnatomyMetricId> = {
  sleep: "SLEEP_SCORE",
  readiness: "READINESS",
  recovery: "RECOVERY_SCORE",
  stress: "STRESS_SCORE",
  strain: "STRAIN_SCORE",
};

/**
 * v1.15.12 — the explainer-body key suffix per score, feeding
 * `insights.subPage.explainer.<suffix>Body` through `SubPageShell`'s
 * `explainerMetric` prop (mirrors the metric sub-pages). `SLEEP_SCORE`
 * uses a distinct `sleepScore` suffix so it never collides with the
 * `sleep` metric's own explainer body.
 */
const EXPLAINER_METRIC: Record<AnatomyMetricId, string> = {
  SLEEP_SCORE: "sleepScore",
  READINESS: "readiness",
  RECOVERY_SCORE: "recovery",
  STRESS_SCORE: "stress",
  STRAIN_SCORE: "strain",
};

/** Localised page header per metric (title + one-line description). */
const HEADER_KEYS: Record<
  AnatomyMetricId,
  { title: string; description: string }
> = {
  SLEEP_SCORE: {
    title: "insights.derived.composite.SLEEP_SCORE.title",
    description: "insights.derived.composite.SLEEP_SCORE.description",
  },
  READINESS: {
    title: "insights.derived.composite.READINESS.title",
    description: "insights.derived.composite.READINESS.description",
  },
  RECOVERY_SCORE: {
    title: "insights.derived.scores.recovery",
    description: "insights.derived.composite.RECOVERY_SCORE.description",
  },
  STRESS_SCORE: {
    title: "insights.derived.scores.stress",
    description: "insights.derived.composite.STRESS_SCORE.description",
  },
  STRAIN_SCORE: {
    title: "insights.derived.scores.strain",
    description: "insights.derived.composite.STRAIN_SCORE.description",
  },
};

export default function CompositeScorePage() {
  const params = useParams<{ metric: string }>();
  const { t } = useTranslations();
  const slug = typeof params.metric === "string" ? params.metric : "";
  const metric: AnatomyMetricId = SLUG_TO_METRIC[slug] ?? "READINESS";
  const header = HEADER_KEYS[metric];

  return (
    <SubPageShell
      title={t(header.title)}
      description={t(header.description)}
      explainerMetric={EXPLAINER_METRIC[metric]}
      backLink={
        <BackLink
          href="/insights"
          label={t("insights.subPage.scoresBack")}
          dataSlot="composite-score-back"
        />
      }
      coachLaunch
    >
      {/* This anatomy view and the `/insights/recovery`
          composite-wearable page both used to render as plain "Recovery", a
          same-name/different-content trap: the score ring here promised one
          thing, the nav pill led somewhere else with no pointer back. The
          label above is now "Recovery score" (matches `measurements.typeRecoveryScore`);
          this line closes the loop with an explicit cross-link. */}
      {metric === "RECOVERY_SCORE" ? (
        <Link
          href="/insights/recovery"
          data-slot="recovery-score-cross-link"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mt-2 inline-flex items-center gap-1.5 text-sm transition-colors focus-visible:ring-[3px] focus-visible:outline-none"
        >
          {t("insights.derived.scores.recoveryCrossLink")}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
      <CompositeScoreAnatomy metric={metric} />
    </SubPageShell>
  );
}
