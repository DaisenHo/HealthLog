"use client";

import Link from "next/link";
import { Brain, Droplets } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InlineAction } from "@/components/ui/inline-action";
import { ScorePill } from "@/components/ui/score-pill";
import { TileHeader } from "@/components/insights/tile-header";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { AssessmentTrend } from "@/lib/mental-health/assessment-trend";
import type { TopicCycleSummary } from "@/lib/topics/read";

import { INSTRUMENT_LABEL, TOPIC_EXTRA_HREF } from "./topic-meta";

const VERDICT_TONE = {
  improved: "success",
  worsened: "warning",
  within_threshold: "neutral",
} as const;

/**
 * The mind topic's screener block: each instrument's latest total and how it
 * moved since the first check-in, measured against the change studies treat
 * as meaningful (the check-in page's own trend).
 */
export function TopicScreenersCard({
  screeners,
}: {
  screeners: AssessmentTrend[];
}) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  return (
    <Card data-slot="topic-screeners">
      <CardHeader>
        <TileHeader
          icon={Brain}
          titleAs="h2"
          title={t("topics.screeners.title")}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {screeners.length === 0 ? (
          <p className="text-sm" data-slot="topic-screeners-none">
            {t("topics.screeners.none")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {screeners.map((trend) => (
              <li
                key={trend.instrument}
                className="flex flex-wrap items-center justify-between gap-2"
                data-slot="topic-screener"
                data-instrument={trend.instrument}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {INSTRUMENT_LABEL[trend.instrument] ?? trend.instrument}{" "}
                    <span className="tabular-nums">
                      {fmt.number(trend.latest.score, 0)}
                    </span>
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t("topics.screeners.checkIns", { count: trend.n })}
                  </p>
                </div>
                {trend.sinceFirst ? (
                  <ScorePill tone={VERDICT_TONE[trend.sinceFirst]}>
                    {t(`topics.screeners.${trend.sinceFirst}`)}
                  </ScorePill>
                ) : (
                  <span className="text-muted-foreground text-xs">
                    {t("topics.screeners.single")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <InlineAction asChild tone="primary" size="xs">
          <Link href={TOPIC_EXTRA_HREF.screeners} className="self-start">
            {t("topics.screeners.open")}
          </Link>
        </InlineAction>
      </CardContent>
    </Card>
  );
}

/**
 * The cycle topic's block: today's cycle day and phase as the cycle page
 * decides them, and the lengths of the completed cycles on record.
 */
export function TopicCycleCard({ cycle }: { cycle: TopicCycleSummary }) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  return (
    <Card data-slot="topic-cycle">
      <CardHeader>
        <TileHeader
          icon={Droplets}
          titleAs="h2"
          title={t("topics.cycle.title")}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {cycle.today ? (
          <p className="text-sm font-medium">
            {cycle.today.phase
              ? t("topics.cycle.todayWithPhase", {
                  day: cycle.today.dayOfCycle,
                  phase: t(`cycle.phase.${cycle.today.phase}`),
                })
              : t("topics.cycle.today", { day: cycle.today.dayOfCycle })}
          </p>
        ) : null}
        {cycle.averageLength !== null ? (
          <p className="text-sm">
            {t("topics.cycle.average", {
              days: fmt.number(cycle.averageLength, 1),
              count: cycle.lengths.length,
            })}
          </p>
        ) : (
          <p className="text-sm" data-slot="topic-cycle-needs">
            {t("topics.cycle.needs", { count: cycle.periodsLogged })}
          </p>
        )}
        {cycle.lengths.length > 0 ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {t("topics.cycle.lengths", {
              lengths: cycle.lengths.map((l) => fmt.integer(l)).join(", "),
            })}
          </p>
        ) : null}
        <InlineAction asChild tone="primary" size="xs">
          <Link href={TOPIC_EXTRA_HREF.cycle} className="self-start">
            {t("topics.cycle.open")}
          </Link>
        </InlineAction>
      </CardContent>
    </Card>
  );
}
