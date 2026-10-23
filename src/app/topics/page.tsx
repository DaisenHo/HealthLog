import { TopicsOverview } from "@/components/topics/topics-overview";
import { TopicsPreviewGate } from "@/components/topics/topics-preview-gate";

/**
 * `/topics` (preview): the topic overview. Exists only for a person who
 * switched the preview on; see `TopicsPreviewGate`.
 */
export default function TopicsPage() {
  return (
    <TopicsPreviewGate>
      <TopicsOverview />
    </TopicsPreviewGate>
  );
}
