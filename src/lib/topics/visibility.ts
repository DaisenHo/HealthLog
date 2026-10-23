/**
 * What a topic may show for the record on screen: the record's module
 * switches and the sections the viewer's grant opens.
 *
 * Both are asked of every signal and every block, not once per topic, so a
 * switched-off module disappears from every topic it would otherwise appear
 * in (sleep from the heart chart, mood from the sleep pairs) and a section the
 * grant does not open is never read.
 */
import type { MeasurementType } from "@/generated/prisma/enums";
import { moduleForMeasurementType } from "@/lib/modules/measurement-scope";
import type { ModuleKey } from "@/lib/modules/registry";
import type { SurfaceModuleMap } from "@/lib/modules/surface";
import type { ShareScope } from "@/lib/sharing/scope";

import {
  MOOD_SIGNAL,
  TOPIC_EXTRA_MODULE,
  TOPICS,
  TOPIC_KEYS,
  type TopicDefinition,
  type TopicExtra,
  type TopicKey,
  type TopicSignalKey,
} from "./registry";

export interface TopicVisibility {
  /** The record's resolved module map; only an explicit `false` hides. */
  modules: SurfaceModuleMap;
  /** Whether the viewer's grant opens a section (always true on one's own). */
  sees: (scope: ShareScope) => boolean;
}

const EXTRA_SECTION: Readonly<Record<TopicExtra, ShareScope>> = {
  training: "measurements",
  labs: "labs",
  screeners: "mind",
  cycle: "cycle",
};

function moduleOn(key: ModuleKey | null, modules: SurfaceModuleMap): boolean {
  return key === null || modules[key] !== false;
}

export function signalModule(key: TopicSignalKey): ModuleKey | null {
  if (key === MOOD_SIGNAL) return "mood";
  return moduleForMeasurementType(key as MeasurementType);
}

export function isSignalVisible(
  key: TopicSignalKey,
  ctx: TopicVisibility,
): boolean {
  const section: ShareScope = key === MOOD_SIGNAL ? "mind" : "measurements";
  return moduleOn(signalModule(key), ctx.modules) && ctx.sees(section);
}

export function isExtraVisible(
  extra: TopicExtra,
  ctx: TopicVisibility,
): boolean {
  return (
    moduleOn(TOPIC_EXTRA_MODULE[extra], ctx.modules) &&
    ctx.sees(EXTRA_SECTION[extra])
  );
}

/** Whether the topic is offered at all under the record's module switches. */
export function isTopicOffered(
  def: TopicDefinition,
  ctx: TopicVisibility,
): boolean {
  if (def.modules.length === 0) return true;
  return def.modules.some((key) => ctx.modules[key] !== false);
}

export function offeredTopics(ctx: TopicVisibility): TopicKey[] {
  return TOPIC_KEYS.filter((key) => isTopicOffered(TOPICS[key], ctx));
}

/** The signals a topic's own list shows, in display order. */
export function visibleSignals(
  def: TopicDefinition,
  ctx: TopicVisibility,
): TopicSignalKey[] {
  return def.signals.filter((key) => isSignalVisible(key, ctx));
}

/** Every signal a topic page reads: its list, its chart and its pairs. */
export function signalsToRead(
  def: TopicDefinition,
  ctx: TopicVisibility,
): Set<TopicSignalKey> {
  const keys = new Set<TopicSignalKey>([...def.signals, ...def.chart]);
  for (const rel of def.relationships) {
    keys.add(rel.x);
    keys.add(rel.y);
  }
  return new Set([...keys].filter((key) => isSignalVisible(key, ctx)));
}

export function visibleExtras(
  def: TopicDefinition,
  ctx: TopicVisibility,
): Set<TopicExtra> {
  return new Set(def.extras.filter((extra) => isExtraVisible(extra, ctx)));
}
