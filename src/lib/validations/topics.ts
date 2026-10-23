/**
 * Request schemas of the topic routes (preview): the topic in the path and
 * the window of a topic page. Shared by the routes and the OpenAPI registry.
 */
import { z } from "zod/v4";

import {
  DEFAULT_TOPIC_RANGE,
  TOPIC_KEYS,
  TOPIC_RANGES,
} from "@/lib/topics/registry";

export const topicKeySchema = z
  .enum(TOPIC_KEYS)
  .describe("The topic, as its URL slug.");

export const topicPathSchema = z.object({ topic: topicKeySchema });

export const topicDetailQuerySchema = z.object({
  range: z
    .enum(TOPIC_RANGES)
    .default(DEFAULT_TOPIC_RANGE)
    .describe(
      "The window the side-by-side series cover. The usual ranges, the trends and the relationships always read at least the trailing 90 days.",
    ),
});

export type TopicDetailQuery = z.infer<typeof topicDetailQuerySchema>;
