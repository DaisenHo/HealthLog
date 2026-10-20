"use client";

/**
 * v1.25.3 — the contained result block: instrument header → result card →
 * crisis card (on a positive PHQ-9 item 9) → required attribution → "take
 * another". Content is unchanged from the v1.25 monolith; it is re-housed as
 * one stack inside the page spine instead of loose top-level sections.
 *
 * v1.27.9 — direction-aware follow-up hints from the registry: PHQ-9/GAD-7
 * keep the ≥10 professional-help suggestion, a WHO-5 total of 50 or below
 * gets a gentle pointer to the PHQ-9 check-in (per the WHO scoring comment),
 * and an SCI total of 16 or below gets the paper's neutral band wording.
 * The attribution footer now comes from the instrument definition.
 *
 * SAFETY: the crisis set rides the POST response (`crisis`) on any non-zero
 * item 9 and renders immediately; this surface never invites an AI Coach
 * conversation about item content.
 */
import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslations } from "@/lib/i18n/context";
import { INSTRUMENTS, needsFollowUp } from "@/lib/mental-health/instruments";

import { CrisisCard } from "./crisis-card";
import type { CreateResponse } from "./types";
import { PageHeader } from "@/components/ui/page-header";

export function AssessmentResult({
  result,
  onTakeAnother,
  onBack,
}: {
  result: CreateResponse;
  onTakeAnother: () => void;
  onBack: () => void;
}) {
  const { t } = useTranslations();
  const instrument = result.assessment.instrument;
  const def = INSTRUMENTS[instrument];
  const key = def.i18nKey;

  // a11y: on submit the wizard unmounts and this view mounts; move focus to the
  // result heading so keyboard / screen-reader users land on the new content
  // rather than being dropped to <body>.
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section
      className="flex flex-col gap-4"
      data-slot="mental-health-result"
      aria-live="polite"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit"
        onClick={onBack}
        data-slot="result-back-to-landing"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("mentalHealth.backToList")}
      </Button>

      <PageHeader
        title={t(`mentalHealth.instrument.${key}`)}
        description={t(`mentalHealth.instrumentDescription.${key}`)}
        headingRef={headingRef}
        focusable
      />

      <p className="text-muted-foreground text-xs" role="status">
        {t("mentalHealth.saved")}
      </p>

      <Card>
        <CardHeader>
          <CardTitle>{t("mentalHealth.result.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">
              {t("mentalHealth.result.totalLabel")}
            </span>
            <span className="text-2xl font-semibold">
              {result.assessment.totalScore}
            </span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">
              {t("mentalHealth.result.bandLabel")}
            </span>
            <span className="font-medium">
              {t(
                `mentalHealth.band.${result.assessment.instrument}.${result.assessment.severityBand}`,
              )}
            </span>
          </div>
          {/* Direction-aware follow-up hint: PHQ-9/GAD-7 point up (≥ 10),
              WHO-5 (≤ 50 → gentle PHQ-9 pointer) and SCI (≤ 16 → the paper's
              neutral band wording) point down. Soft suggestions, never a
              diagnosis. */}
          {needsFollowUp(instrument, result.assessment.totalScore) && (
            <p
              className="text-muted-foreground bg-muted/40 rounded-md p-3 text-xs"
              data-slot="result-follow-up-hint"
            >
              {t(`mentalHealth.followUpHint.${key}`)}
            </p>
          )}
        </CardContent>
      </Card>

      {result.crisis && <CrisisCard crisis={result.crisis} />}

      <p className="text-muted-foreground text-xs leading-snug">
        <span className="font-medium">
          {t("mentalHealth.attributionLabel")}:
        </span>{" "}
        {def.attribution}
      </p>

      <Button variant="outline" onClick={onTakeAnother}>
        {t("mentalHealth.result.takeAnother")}
      </Button>
    </section>
  );
}
