"use client";

import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TileHeader } from "@/components/insights/tile-header";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/lib/i18n/context";

/**
 * The onboarding "aha" artifact — a static, clearly-labelled *example*
 * daily briefing shown BEFORE any AI provider is connected.
 *
 * It exists so a fresh user feels the payoff of AI Insights with zero
 * setup: no provider is configured yet, so this makes no model call, no
 * fetch, no egress, and needs no consent. Every number is fixed copy
 * from the `onboarding.ai.sample*` keys (the worked example the
 * no-provider briefing empty state already carries) — it is never
 * derived from the user's own record, and the "Example" badge plus the
 * caption make that explicit so it is never mistaken for real data.
 *
 * Presentational only — no state, no effect, no data fetch. Reused by
 * the onboarding done-screen panel; safe to drop into any surface that
 * wants to show what a briefing reads like.
 */
export function SampleBriefingCard({ className }: { className?: string }) {
  const { t } = useTranslations();

  return (
    <Card
      data-slot="sample-briefing-card"
      aria-label={t("onboarding.ai.sampleAriaLabel")}
      density="compact"
      className={cn("bg-muted/30", className)}
    >
      <CardHeader>
        <TileHeader
          icon={Sparkles}
          title={t("onboarding.ai.sampleTitle")}
          right={
            <Badge variant="secondary" data-slot="sample-briefing-tag">
              {t("onboarding.ai.sampleTag")}
            </Badge>
          }
        />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-foreground text-sm leading-relaxed">
          {t("onboarding.ai.sampleBody")}
        </p>
        <p className="text-muted-foreground text-xs leading-relaxed">
          {t("onboarding.ai.sampleCaption")}
        </p>
      </CardContent>
    </Card>
  );
}
