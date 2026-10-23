import { notFound } from "next/navigation";

import { TopicDetailView } from "@/components/topics/topic-detail";
import { TopicsPreviewGate } from "@/components/topics/topics-preview-gate";
import { isTopicKey } from "@/lib/topics/registry";

/**
 * `/topics/<topic>` (preview): one topic page. A name that is not a topic is
 * a 404 here, before anything renders; the preview switch is checked by the
 * gate, the record's modules by the route behind the page.
 */
export default async function TopicPage({
  params,
}: {
  params: Promise<{ topic: string }>;
}) {
  const { topic } = await params;
  if (!isTopicKey(topic)) notFound();
  return (
    <TopicsPreviewGate>
      <TopicDetailView topic={topic} />
    </TopicsPreviewGate>
  );
}
