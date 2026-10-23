"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScorePill } from "@/components/ui/score-pill";
import { TileHeader } from "@/components/insights/tile-header";
import { useTranslations } from "@/lib/i18n/context";
import type { TopicOverviewEntry } from "@/lib/topics/build";

import { TOPIC_ICONS, topicHref, topicTitleKey } from "./topic-meta";
import { TopicSummaryText, useHeadline } from "./topic-summary";

// The sparkline loads through the shared chart runtime, so the overview's own
// chunk carries no recharts; the tile owns the fixed band it draws in.
const DeltaSparkline = dynamic(
  () =>
    import("@/components/charts/chart-runtime").then((mod) => ({
      default: mod.DeltaSparkline,
    })),
  { ssr: false, loading: () => null },
);

const TONE_PILL = {
  steady: "success",
  watch: "warning",
  learning: "neutral",
} as const;

/**
 * One topic on the overview: its name (the link), the headline value, the
 * rule-based sentence, the last 30 days as a sparkline, and how many of the
 * topic's signals hold a value. The whole card is the target, through the
 * title link stretched over it, so the link's name is the visible title.
 */
export function TopicTile({ entry }: { entry: TopicOverviewEntry }) {
  const { t } = useTranslations();
  const headline = useHeadline(entry.headline);
  const title = t(topicTitleKey(entry.key));
  const points = entry.sparkline.map((v, i) => ({ i, v }));

  return (
    <Card
      data-slot="topic-tile"
      data-topic={entry.key}
      data-tone={entry.tone}
      className="hover:bg-accent/40 relative gap-2 transition-colors md:gap-3"
    >
      <CardHeader>
        <TileHeader
          icon={TOPIC_ICONS[entry.key]}
          titleAs="h2"
          title={
            <Link
              href={topicHref(entry.key)}
              data-slot="topic-tile-link"
              className="focus-visible:ring-ring/50 rounded-sm after:absolute after:inset-0 after:rounded-xl focus-visible:ring-2 focus-visible:outline-none"
            >
              {title}
            </Link>
          }
        />
      </CardHeader>
      <CardContent className="flex min-w-0 flex-1 flex-col gap-2">
        {headline ? (
          <p className="text-foreground flex items-baseline gap-1.5">
            <span className="text-2xl font-semibold tabular-nums">
              {headline.value}
            </span>
            {headline.unit ? (
              <span className="text-muted-foreground text-sm">
                {headline.unit}
              </span>
            ) : null}
          </p>
        ) : null}
        <TopicSummaryText summary={entry.summary} className="text-sm" />
        {points.length >= 2 ? (
          <div className="h-10" aria-hidden="true">
            <DeltaSparkline data={points} strokeVar="var(--chart-1)" />
          </div>
        ) : null}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <ScorePill tone={TONE_PILL[entry.tone]}>
            {t(`topics.tone.${entry.tone}`)}
          </ScorePill>
          {entry.recorded > 0 ? (
            <span className="text-muted-foreground text-xs">
              {t("topics.recorded", {
                count: entry.recorded,
                total: entry.total,
              })}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
