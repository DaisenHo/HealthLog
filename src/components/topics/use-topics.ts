"use client";

/**
 * The two topic reads. Each answer is the server's, rendered as given; the
 * failed read hands its `ApiError` through untouched so the surface's
 * read-failure primitive decides what to offer.
 */
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/lib/api/api-fetch";
import { queryKeys } from "@/lib/query-keys";
import type { TopicDetail, TopicOverview } from "@/lib/topics/build";
import type { TopicKey, TopicRange } from "@/lib/topics/registry";

export function useTopicOverview(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.topicsOverview(),
    queryFn: () => apiGet<TopicOverview>("/api/topics"),
    enabled,
  });
}

export function useTopicDetail(
  topic: TopicKey,
  range: TopicRange,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.topicDetail(topic, range),
    queryFn: () =>
      apiGet<TopicDetail>(
        `/api/topics/${encodeURIComponent(topic)}?range=${encodeURIComponent(range)}`,
      ),
    enabled,
    placeholderData: (previous) => previous,
  });
}
