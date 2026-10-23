"use client";

import { useState } from "react";

import { TrainingLoadCard } from "@/components/workouts/training-load-card";
import { PageHeader } from "@/components/ui/page-header";
import { QueryErrorCard } from "@/components/ui/query-error-card";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslations } from "@/lib/i18n/context";
import {
  DEFAULT_TOPIC_RANGE,
  TOPIC_RANGES,
  type TopicKey,
  type TopicRange,
} from "@/lib/topics/registry";

import { PreviewBadge } from "./preview-badge";
import { PreviewNote } from "./preview-note";
import { TopicCycleCard, TopicScreenersCard } from "./topic-blocks";
import { TopicLabsCard } from "./topic-labs-card";
import { TopicLinksCard, TopicMissingCard } from "./topic-links-card";
import { topicDescriptionKey, topicTitleKey } from "./topic-meta";
import { TopicRelationshipsCard } from "./topic-relationships-card";
import { TopicSideBySideCard } from "./topic-side-by-side-card";
import { TopicTodayCard } from "./topic-today-card";
import { TopicTrendsCard } from "./topic-trends-card";
import { useTopicDetail } from "./use-topics";

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <Skeleton className="h-40 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
      <div className="grid gap-4 md:grid-cols-2">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    </div>
  );
}

/**
 * `/topics/<topic>`: the topic's signals today, side by side over a chosen
 * window, how they move together, their trends, the topic's blocks, the
 * single-metric pages behind it and what it holds nothing for yet.
 */
export function TopicDetailView({ topic }: { topic: TopicKey }) {
  const { t } = useTranslations();
  const [range, setRange] = useState<TopicRange>(DEFAULT_TOPIC_RANGE);
  const query = useTopicDetail(topic, range, true);
  const detail = query.data?.key === topic ? query.data : undefined;

  return (
    <div className="space-y-6" data-slot="topic-detail" data-topic={topic}>
      <PageHeader
        title={t(topicTitleKey(topic))}
        titleAccessory={<PreviewBadge label={t("nav.previewBadge")} />}
        description={t(topicDescriptionKey(topic))}
        backLink={{
          href: "/topics",
          label: t("topics.detail.back"),
          dataSlot: "topic-back",
        }}
      />
      <Segmented
        options={TOPIC_RANGES.map((value) => ({
          value,
          label: t(`topics.range.${value}`),
        }))}
        value={range}
        onChange={setRange}
        label={t("topics.range.label")}
        slot="topic-range"
        size="sm"
      />

      {query.isError ? (
        <QueryErrorCard
          error={query.error}
          title={t("topics.loadError")}
          onRetry={() => void query.refetch()}
        />
      ) : !detail ? (
        <DetailSkeleton />
      ) : (
        <div
          className="space-y-6"
          data-slot="topic-detail-body"
          data-status={detail.status}
        >
          <TopicTodayCard detail={detail} />
          <TopicSideBySideCard detail={detail} />
          {detail.relationships.length > 0 ||
          detail.trends.length > 0 ||
          detail.training?.status === "ok" ? (
            <div className="grid items-start gap-4 md:grid-cols-2">
              <TopicRelationshipsCard relationships={detail.relationships} />
              <div className="flex flex-col gap-4">
                <TopicTrendsCard trends={detail.trends} />
                <TrainingLoadCard trainingLoad={detail.training ?? undefined} />
              </div>
            </div>
          ) : null}
          {detail.labs ? <TopicLabsCard labs={detail.labs} /> : null}
          {detail.screeners ? (
            <TopicScreenersCard screeners={detail.screeners} />
          ) : null}
          {detail.cycle ? <TopicCycleCard cycle={detail.cycle} /> : null}
          <div className="grid items-start gap-4 md:grid-cols-2">
            <TopicLinksCard detail={detail} />
            <TopicMissingCard detail={detail} />
          </div>
        </div>
      )}
      <PreviewNote />
    </div>
  );
}
