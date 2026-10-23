"use client";

import Link from "next/link";
import { ChevronRight, Sun } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { InlineAction } from "@/components/ui/inline-action";
import { ScorePill } from "@/components/ui/score-pill";
import { TileHeader } from "@/components/insights/tile-header";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { TopicDetail, TopicSignal } from "@/lib/topics/build";

import { TopicSummaryText } from "./topic-summary";
import { useSignalFormat } from "./use-signal-format";

const STATE_TONE = {
  within: "success",
  above: "warning",
  below: "warning",
  learning: "neutral",
} as const;

function SignalReadout({
  signal,
  todayKey,
}: {
  signal: TopicSignal;
  todayKey: string;
}) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const format = useSignalFormat();
  if (!signal.latest) return null;
  const label = format.label(signal.key);
  const unit = format.unit(signal.key);
  const usual = signal.usual;
  return (
    <div
      className="flex min-w-0 flex-col gap-1"
      data-slot="topic-signal"
      data-signal={signal.key}
      data-state={signal.state}
    >
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-foreground flex items-baseline gap-1">
        <span className="text-xl font-semibold tabular-nums">
          {format.number(signal.key, signal.latest.value)}
        </span>
        {unit ? (
          <span className="text-muted-foreground text-xs">{unit}</span>
        ) : null}
      </dd>
      <dd className="text-muted-foreground text-xs">
        {usual
          ? t("topics.today.usual", {
              low: format.number(signal.key, usual.low),
              high: format.number(signal.key, usual.high),
            })
          : t("topics.today.learning")}
      </dd>
      {signal.latest.day !== todayKey ? (
        <dd className="text-muted-foreground text-xs">
          {t("topics.today.asOf", {
            date: fmt.dateShortSmartCalendar(signal.latest.day),
          })}
        </dd>
      ) : null}
      <dd className="flex flex-wrap items-center gap-2">
        {signal.state !== "none" ? (
          <ScorePill tone={STATE_TONE[signal.state]}>
            {t(`topics.state.${signal.state}`)}
          </ScorePill>
        ) : null}
        {signal.href ? (
          <InlineAction asChild tone="primary" size="xs">
            <Link href={signal.href}>
              {t("topics.today.details")}
              <span className="sr-only">: {label}</span>
              <ChevronRight className="size-3" aria-hidden="true" />
            </Link>
          </InlineAction>
        ) : null}
      </dd>
    </div>
  );
}

/**
 * The topic today: its one sentence, then each recorded signal with its
 * latest value, its usual range and a way into its own page.
 */
export function TopicTodayCard({ detail }: { detail: TopicDetail }) {
  const { t } = useTranslations();
  const recorded = detail.signals.filter((s) => s.latest !== null);
  return (
    <Card data-slot="topic-today">
      <CardHeader>
        <TileHeader icon={Sun} titleAs="h2" title={t("topics.today.title")} />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <TopicSummaryText
          summary={detail.summary}
          className="text-base font-medium"
        />
        {recorded.length > 0 ? (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-4">
            {recorded.map((signal) => (
              <SignalReadout
                key={signal.key}
                signal={signal}
                todayKey={detail.to}
              />
            ))}
          </dl>
        ) : null}
      </CardContent>
    </Card>
  );
}
