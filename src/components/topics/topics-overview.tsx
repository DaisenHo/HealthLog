"use client";

import Link from "next/link";
import { Layers } from "lucide-react";

import { EmptyState } from "@/components/ui/empty-state";
import { InlineAction } from "@/components/ui/inline-action";
import { PageHeader } from "@/components/ui/page-header";
import { QueryErrorCard } from "@/components/ui/query-error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRecordCapabilities } from "@/hooks/use-record-capabilities";
import { useTranslations } from "@/lib/i18n/context";
import type { TopicKey } from "@/lib/topics/registry";

import { PreviewBadge } from "./preview-badge";
import { PreviewNote } from "./preview-note";
import { topicTitleKey } from "./topic-meta";
import { TopicTile } from "./topic-tile";
import { useTopicOverview } from "./use-topics";

function useTopicList() {
  const { t } = useTranslations();
  return (keys: readonly TopicKey[]) =>
    keys.map((key) => t(topicTitleKey(key))).join(", ");
}

/**
 * `/topics`: one tile per topic the record holds data for. Topics with
 * nothing recorded yet and topics whose module is off are named once each,
 * at the end, with where to change that; neither gets an empty tile.
 */
export function TopicsOverview() {
  const { t } = useTranslations();
  const list = useTopicList();
  const { inSharedRecord } = useRecordCapabilities();
  const query = useTopicOverview(true);
  const data = query.data;

  return (
    <div className="space-y-6" data-slot="topics-overview">
      <PageHeader
        title={t("topics.overview.title")}
        titleAccessory={<PreviewBadge label={t("nav.previewBadge")} />}
        description={t("topics.overview.description")}
      />

      {query.isError ? (
        <QueryErrorCard
          error={query.error}
          title={t("topics.loadError")}
          onRetry={() => void query.refetch()}
        />
      ) : !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-56 rounded-xl" />
          ))}
        </div>
      ) : data.topics.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-6" aria-hidden="true" />}
          title={t("topics.overview.emptyTitle")}
          description={t("topics.overview.emptyDescription")}
        />
      ) : (
        <div
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          data-slot="topics-grid"
        >
          {data.topics.map((entry) => (
            <TopicTile key={entry.key} entry={entry} />
          ))}
        </div>
      )}

      {data && data.empty.length > 0 ? (
        <p
          className="text-muted-foreground text-xs"
          data-slot="topics-empty-list"
        >
          {t("topics.overview.notRecorded", { topics: list(data.empty) })}
        </p>
      ) : null}
      {data && data.hiddenByModule.length > 0 ? (
        <p
          className="text-muted-foreground text-xs"
          data-slot="topics-hidden-list"
        >
          {t("topics.overview.hiddenByModule", {
            topics: list(data.hiddenByModule),
          })}{" "}
          {inSharedRecord ? null : (
            <InlineAction asChild tone="muted" size="xs">
              <Link href="/settings/modules">
                {t("topics.overview.modulesLink")}
              </Link>
            </InlineAction>
          )}
        </p>
      ) : null}
      <PreviewNote />
    </div>
  );
}
