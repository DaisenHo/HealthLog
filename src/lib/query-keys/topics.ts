/**
 * Query keys — the topic pages (preview).
 * Part of the centralized factory; aggregated in `./index.ts`.
 */
export const topicKeys = {
  /** Every topic read; a write to any record table the topics read evicts it. */
  topicsRoot: () => ["topics"] as const,
  topicsOverview: () => ["topics", "overview"] as const,
  topicDetail: (topic: string, range: string) =>
    ["topics", "detail", topic, range] as const,
};
