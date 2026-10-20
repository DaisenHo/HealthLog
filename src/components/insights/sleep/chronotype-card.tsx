"use client";

import { useState } from "react";
import { Clock, ChevronDown, ChevronUp } from "lucide-react";

import { useTranslations } from "@/lib/i18n/context";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { LearningGate } from "@/components/ui/learning-gate";
import { TileHeader } from "@/components/insights/tile-header";
import type { ChronotypeDto } from "./use-sleep-rhythm";
import { InlineAction } from "@/components/ui/inline-action";

/** Minutes-of-day → "HH:MM" wall-clock label (24 h, zero-padded). */
function clockLabel(minutesOfDay: number): string {
  const wrapped = ((Math.round(minutesOfDay) % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = wrapped - h * 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Whole hours + minutes from a minute total, for the social-jetlag readout. */
function hoursMinutes(totalMinutes: number): {
  hours: number;
  minutes: number;
} {
  const t = Math.round(totalMinutes);
  return { hours: Math.floor(t / 60), minutes: t - Math.floor(t / 60) * 60 };
}

/**
 * v1.17.0 — chronotype card (MCTQ MSF / MSFsc band + social jetlag).
 *
 * v1.19.0 — brought to the SAME tile shape as `<SleepDebtCard>` so the two sit
 * uniform in the shared grid row: identical card chrome, an icon + `text-base`
 * `CardTitle` header, then a `space-y-0.5` value block with a bold primary value
 * (`text-2xl font-semibold`) and one secondary `text-xs muted` line. The primary
 * value is the chronotype BAND (a label, the slot the debt tile fills with an
 * hours figure); the concrete companion — the natural sleep midpoint clock — is
 * the secondary line, so both tiles read "bold value + one grounded line" at the
 * same scale. The "advanced" disclosure (social jetlag + sleep-debt-corrected
 * MSFsc) stays. While `learning` it keeps the calm "still learning your rhythm —
 * N of M nights" copy and asserts NO band. Warm, grounded copy; mobile-first.
 */
export function ChronotypeCard({ chronotype }: { chronotype: ChronotypeDto }) {
  const { t } = useTranslations();
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (chronotype.state === "learning" || chronotype.band == null) {
    const need = chronotype.freeNightsCounted + chronotype.freeNightsUntilReady;
    return (
      <Card data-slot="chronotype-card">
        <CardHeader>
          <TileHeader
            icon={Clock}
            title={t("insights.sleep.chronotype.title")}
          />
        </CardHeader>
        <CardContent>
          <LearningGate
            message={t("insights.sleep.chronotype.learning", {
              counted: chronotype.freeNightsCounted,
              total: need,
            })}
          />
        </CardContent>
      </Card>
    );
  }

  const bandLabel = t(`insights.sleep.chronotype.band.${chronotype.band}`);
  const msfClock =
    chronotype.msfMinutes != null ? clockLabel(chronotype.msfMinutes) : null;

  return (
    <Card data-slot="chronotype-card">
      <CardHeader>
        <TileHeader icon={Clock} title={t("insights.sleep.chronotype.title")} />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Uniform with the sleep-debt tile: a bold primary value (the band) at
            the same scale, with the concrete companion (natural sleep midpoint
            clock) as the secondary muted line. */}
        <div className="space-y-0.5" data-slot="chronotype-band">
          <p className="text-2xl font-semibold">{bandLabel}</p>
          {msfClock && (
            <p className="text-muted-foreground text-xs">
              {t("insights.sleep.chronotype.midpointHeadline", {
                clock: msfClock,
              })}
            </p>
          )}
        </div>

        <InlineAction
          tone="muted"
          className="font-medium"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          aria-controls="chronotype-advanced"
        >
          {showAdvanced ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
          {t("insights.sleep.chronotype.advancedToggle")}
        </InlineAction>

        {showAdvanced && (
          <div id="chronotype-advanced" className="space-y-2 border-t pt-3">
            {chronotype.socialJetlagMinutes != null &&
              (() => {
                const { hours, minutes } = hoursMinutes(
                  chronotype.socialJetlagMinutes,
                );
                return (
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">
                      {t("insights.sleep.chronotype.socialJetlagValue", {
                        hours,
                        minutes,
                      })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {t("insights.sleep.chronotype.socialJetlagCaption")}
                    </p>
                  </div>
                );
              })()}
            {chronotype.msfScMinutes != null && (
              <div className="space-y-0.5">
                <p className="text-sm font-medium tabular-nums">
                  {t("insights.sleep.chronotype.msfScValue", {
                    clock: clockLabel(chronotype.msfScMinutes),
                  })}
                </p>
                <p className="text-muted-foreground text-xs">
                  {t("insights.sleep.chronotype.msfScCaption")}
                </p>
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              {t("insights.sleep.chronotype.dayTypeNote")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
