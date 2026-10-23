/**
 * Client-side presentation of the topics: the glyph per topic, the message
 * keys of its name and description, and where each extra block's own page
 * lives. Kept apart from the server registry so the browser bundle carries
 * no read code; the keys themselves come from `@/lib/topics/registry`.
 */
import {
  Activity,
  Brain,
  Droplets,
  FlaskConical,
  Gauge,
  Heart,
  Moon,
  Scale,
  type LucideIcon,
} from "lucide-react";

import type { TopicExtra, TopicKey } from "@/lib/topics/registry";

export const TOPIC_ICONS: Readonly<Record<TopicKey, LucideIcon>> = {
  heart: Heart,
  body: Scale,
  "blood-pressure": Gauge,
  sleep: Moon,
  activity: Activity,
  metabolism: FlaskConical,
  mind: Brain,
  cycle: Droplets,
};

/** Message-key segment per topic (`topics.names.<id>.title`). */
export const TOPIC_MESSAGE_ID: Readonly<Record<TopicKey, string>> = {
  heart: "heart",
  body: "body",
  "blood-pressure": "bloodPressure",
  sleep: "sleep",
  activity: "activity",
  metabolism: "metabolism",
  mind: "mind",
  cycle: "cycle",
};

export function topicTitleKey(key: TopicKey): string {
  return `topics.names.${TOPIC_MESSAGE_ID[key]}.title`;
}

export function topicDescriptionKey(key: TopicKey): string {
  return `topics.names.${TOPIC_MESSAGE_ID[key]}.description`;
}

/** Where to record what an empty topic is missing (`topics.empty.<id>`). */
export function topicSourcesKey(key: TopicKey): string {
  return `topics.sources.${TOPIC_MESSAGE_ID[key]}`;
}

/** The page each extra block opens. */
export const TOPIC_EXTRA_HREF: Readonly<Record<TopicExtra, string>> = {
  training: "/insights/workouts",
  labs: "/labs",
  screeners: "/mental-wellbeing",
  cycle: "/cycle",
};

export function topicHref(key: TopicKey): string {
  return `/topics/${key}`;
}

/** The screener names as the check-in page writes them. */
export const INSTRUMENT_LABEL: Readonly<Record<string, string>> = {
  PHQ9: "PHQ-9",
  GAD7: "GAD-7",
  WHO5: "WHO-5",
};
