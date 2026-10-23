/**
 * The topic routes' one entry: who may see the topics, what the record may
 * show, and the reads and assembly behind both answers.
 *
 * Two people are in play and they are kept apart. The preview switch is the
 * VIEWER's (`actorId`): a preview is chrome of the person reading, so it is
 * their opt-in that decides whether the topics exist for them. Everything the
 * page shows is the RECORD's (`userId`): its module switches decide which
 * topics, signals and blocks are offered, and the sections the viewer's grant
 * opens decide which of them may be read at all.
 */
import { prisma } from "@/lib/db";
import { resolveModuleMap } from "@/lib/modules/gate";
import { resolvePreviewFeatures } from "@/lib/settings/preview-features";
import { actingDomainVisibility } from "@/lib/sharing/acting-domains";
import { shiftDateKey, userDayKey } from "@/lib/tz/format";
import { resolveUserTimezone } from "@/lib/tz/resolver";

import {
  buildDetail,
  buildOverview,
  detailReadStart,
  type TopicDetail,
  type TopicOverview,
} from "./build";
import { readTopicInputs } from "./read";
import {
  TOPIC_BASE_WINDOW_DAYS,
  TOPICS,
  TOPIC_KEYS,
  type TopicExtra,
  type TopicKey,
  type TopicRange,
  type TopicSignalKey,
} from "./registry";
import {
  isExtraVisible,
  isTopicOffered,
  offeredTopics,
  signalsToRead,
  visibleExtras,
  visibleSignals,
  type TopicVisibility,
} from "./visibility";

/** Whether the viewer switched the topics preview on for themselves. */
export async function hasTopicsPreview(actorId: string): Promise<boolean> {
  const row = await prisma.user.findUnique({
    where: { id: actorId },
    select: { previewFeaturesJson: true },
  });
  return resolvePreviewFeatures(row?.previewFeaturesJson).topics;
}

async function visibilityFor(
  userId: string,
  grantId: string | null,
): Promise<TopicVisibility> {
  const [modules, sees] = await Promise.all([
    resolveModuleMap(userId),
    actingDomainVisibility(prisma, grantId),
  ]);
  return { modules, sees };
}

async function today(userId: string, now: Date) {
  const tz = await resolveUserTimezone(userId);
  return { tz, todayKey: userDayKey(now, tz) };
}

export async function loadTopicOverview(args: {
  userId: string;
  grantId: string | null;
  now: Date;
}): Promise<TopicOverview> {
  const ctx = await visibilityFor(args.userId, args.grantId);
  const { tz, todayKey } = await today(args.userId, args.now);
  const offered = offeredTopics(ctx);
  const hidden = TOPIC_KEYS.filter((key) => !offered.includes(key));

  // The overview needs each offered topic's own list and its blocks, not its
  // chart or pairs; the training load stays on the topic page.
  const signals = new Set<TopicSignalKey>();
  const extras = new Set<TopicExtra>();
  for (const key of offered) {
    const def = TOPICS[key];
    for (const signal of visibleSignals(def, ctx)) signals.add(signal);
    for (const extra of def.extras) {
      if (extra !== "training" && isExtraVisible(extra, ctx)) extras.add(extra);
    }
  }

  const inputs = await readTopicInputs({
    userId: args.userId,
    tz,
    todayKey,
    fromKey: shiftDateKey(todayKey, -(TOPIC_BASE_WINDOW_DAYS - 1)),
    signals,
    extras,
    now: args.now,
  });
  return buildOverview(offered, hidden, inputs, ctx, todayKey);
}

/** One topic page, or null when the record's switches do not offer it. */
export async function loadTopicDetail(args: {
  userId: string;
  grantId: string | null;
  topic: TopicKey;
  range: TopicRange;
  now: Date;
}): Promise<TopicDetail | null> {
  const ctx = await visibilityFor(args.userId, args.grantId);
  const def = TOPICS[args.topic];
  if (!isTopicOffered(def, ctx)) return null;
  const { tz, todayKey } = await today(args.userId, args.now);
  const inputs = await readTopicInputs({
    userId: args.userId,
    tz,
    todayKey,
    fromKey: detailReadStart(args.range, todayKey),
    signals: signalsToRead(def, ctx),
    extras: visibleExtras(def, ctx),
    now: args.now,
  });
  return buildDetail(def, args.range, inputs, ctx, todayKey);
}
