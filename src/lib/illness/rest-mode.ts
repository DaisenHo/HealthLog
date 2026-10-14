/**
 * Rest Mode — the server-authoritative "the account is unwell right now"
 * context (v1.18.1, P4).
 *
 * CORE PRINCIPLE: an active illness episode ANNOTATES, it never PENALISES.
 * Rest Mode never changes a measured number — it only frames the narrative
 * around it: the health score keeps its value but carries a "you were unwell"
 * note, recovery keeps its number, achievement streaks freeze (rather than
 * break) across the days you were ill, cadence-nudges pause, and the Today
 * strip counts the days since onset.
 *
 * This module is the ONE place that resolves "is the account in Rest Mode
 * right now, and which episodes back it" — so every surface annotates from
 * the same fact. It is server-authoritative: the resolved `RestModeContext`
 * is the DTO the iOS client mirrors (it renders Rest Mode, never recomputes
 * the suppression). The illness module gate is honoured: a disabled / opted-
 * out account is never in Rest Mode (the gate short-circuits before any read).
 *
 * Two different questions are answered here, and they must not be confused:
 *
 *  - "Which episodes are active?" (`getActiveIllnessEpisodes`): every
 *    `IllnessEpisode` with `resolvedAt = null`, not soft-deleted, whose
 *    `onsetAt` is on or before the reference instant. CHRONIC_ONGOING
 *    conditions are included. This is CONTEXT: a measured dip that coincides
 *    with a known chronic condition is still framed as explained by it
 *    (`hasActiveIllnessEpisode`), and the Coach still sees the condition.
 *
 *  - "Is the account in Rest Mode?" (`resolveRestMode`): only the active
 *    episodes that are NOT CHRONIC_ONGOING (acute, recurring, flare). A
 *    chronic condition has no end date by design, so letting it trigger Rest
 *    Mode would put the account into it permanently: the Day N counter would
 *    count from an onset years back, nudges would never resume and streaks
 *    could never break. A flare threaded under a chronic condition carries its
 *    own lifecycle (FLARE), so a chronic condition getting worse still does.
 *    `since` and Day N count from the earliest onset among the episodes that
 *    trigger Rest Mode, never from a chronic onset.
 *
 * Every reader that freezes, pauses or counts on Rest Mode's behalf goes
 * through `triggersRestMode` / `REST_MODE_EPISODE_WHERE`, including the
 * achievements streak freeze, which runs its own windowed query.
 */
import type { PrismaClient, IllnessEpisode } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { isIllnessEnabled } from "@/lib/illness/gate";
import { memoizePerRequest } from "@/lib/request-cache";

/**
 * The lifecycle that never triggers Rest Mode on its own: a condition the
 * person lives with. See the module header.
 */
export const REST_MODE_EXEMPT_LIFECYCLE = "CHRONIC_ONGOING" as const;

/**
 * Prisma `where` fragment selecting the episodes that can trigger Rest Mode.
 * For readers that query episodes themselves (the achievements streak freeze
 * reads resolved ones too, over a window) instead of going through
 * `resolveRestMode`.
 */
export const REST_MODE_EPISODE_WHERE = {
  lifecycle: { not: REST_MODE_EXEMPT_LIFECYCLE },
} as const;

/** Whether an episode, while active, puts the account into Rest Mode. */
export function triggersRestMode(episode: { lifecycle: string }): boolean {
  return episode.lifecycle !== REST_MODE_EXEMPT_LIFECYCLE;
}

/** Minimal shape the Rest Mode resolver needs from an episode row. */
export type ActiveIllnessEpisode = Pick<
  IllnessEpisode,
  "id" | "label" | "type" | "lifecycle" | "onsetAt"
>;

/**
 * The resolved Rest Mode annotation a surface attaches to its result. Carries
 * NO measured value — it is pure narrative context. `active` is the single
 * flag a renderer branches on; `since` is the earliest active onset (the
 * "unwell since" anchor); `episodes` is the small set backing it (label +
 * type only — no decrypted note, no free-text leaks into a score payload).
 *
 * This is the server-authoritative shape iOS mirrors verbatim.
 */
export interface RestModeContext {
  /**
   * True when ≥ 1 active episode that is not CHRONIC_ONGOING exists as of the
   * reference instant.
   */
  active: boolean;
  /** ISO onset of the earliest episode backing Rest Mode, or null when none. */
  since: string | null;
  /** Count of episodes backing Rest Mode (usually 1; ≥ 2 when they overlap). */
  episodeCount: number;
  /**
   * The episodes backing Rest Mode, label + type + onset only — never a
   * decrypted note. Chronic conditions are not among them.
   */
  episodes: Array<{
    id: string;
    label: string;
    type: string;
    lifecycle: string;
    onsetAt: string;
  }>;
}

/** The neutral, honest empty state — not in Rest Mode. */
export const REST_MODE_INACTIVE: RestModeContext = {
  active: false,
  since: null,
  episodeCount: 0,
  episodes: [],
};

/**
 * Read the active illness episodes for an account as of `asOf`, chronic
 * conditions included — the context set, not the Rest Mode set (that is
 * `toRestModeContext` over this). Gated through
 * the illness module: a disabled / not-opted-in account returns `[]` without
 * touching the episode table. The reference instant is injectable so the
 * resolver is deterministic for tests and so a nightly job can resolve "as of
 * the scored day".
 */
export async function getActiveIllnessEpisodes(
  userId: string,
  asOf: Date = new Date(),
  client: PrismaClient = defaultPrisma,
): Promise<ActiveIllnessEpisode[]> {
  // Several surfaces resolve Rest Mode for the same `(userId, asOf)` inside
  // one request — the snapshot builder, the recovery score it builds, the
  // analytics route, and coincident-deviation — each firing an identical
  // `findMany`. Dedupe them to a single read per request. An explicit client
  // (a test stub or a transaction) bypasses the memo so its query is never
  // served a default-client cached result.
  if (client !== defaultPrisma)
    return readActiveIllnessEpisodes(userId, asOf, client);
  return memoizePerRequest(
    `illness-active-episodes:${userId}:${asOf.getTime()}`,
    () => readActiveIllnessEpisodes(userId, asOf, client),
  );
}

async function readActiveIllnessEpisodes(
  userId: string,
  asOf: Date,
  client: PrismaClient,
): Promise<ActiveIllnessEpisode[]> {
  if (!(await isIllnessEnabled(userId))) return [];
  return client.illnessEpisode.findMany({
    where: {
      userId,
      deletedAt: null,
      resolvedAt: null,
      onsetAt: { lte: asOf },
    },
    select: {
      id: true,
      label: true,
      type: true,
      lifecycle: true,
      onsetAt: true,
    },
    orderBy: { onsetAt: "asc" },
  });
}

/**
 * Fold a set of active episodes into the renderable Rest Mode context. Pure.
 * Only the episodes that trigger Rest Mode count: a chronic condition alone
 * leaves the account out of it, and `since` is the earliest onset among the
 * episodes that do (the input is onset-ascending).
 */
export function toRestModeContext(
  activeEpisodes: ActiveIllnessEpisode[],
): RestModeContext {
  const episodes = activeEpisodes
    .filter(triggersRestMode)
    .sort((a, b) => a.onsetAt.getTime() - b.onsetAt.getTime());
  if (episodes.length === 0) return REST_MODE_INACTIVE;
  return {
    active: true,
    since: episodes[0].onsetAt.toISOString(),
    episodeCount: episodes.length,
    episodes: episodes.map((e) => ({
      id: e.id,
      label: e.label,
      type: e.type,
      lifecycle: e.lifecycle,
      onsetAt: e.onsetAt.toISOString(),
    })),
  };
}

/**
 * Resolve the Rest Mode context for an account as of `asOf` — the one call a
 * surface makes to learn whether to annotate. Module-gated and fail-soft: any
 * resolution error reads as "not in Rest Mode" so a Rest Mode read can never
 * break the score / recovery / achievements payload it annotates.
 */
export async function resolveRestMode(
  userId: string,
  asOf: Date = new Date(),
  client: PrismaClient = defaultPrisma,
): Promise<RestModeContext> {
  try {
    const episodes = await getActiveIllnessEpisodes(userId, asOf, client);
    return toRestModeContext(episodes);
  } catch {
    return REST_MODE_INACTIVE;
  }
}

/**
 * Whether any illness episode is active as of `asOf`, chronic conditions
 * included. For framing a measured deviation as explained by a known
 * condition, which a chronic one does as much as an acute one. Not Rest Mode:
 * nothing may freeze, pause or count on this. Fail-soft like
 * `resolveRestMode`.
 */
export async function hasActiveIllnessEpisode(
  userId: string,
  asOf: Date = new Date(),
  client: PrismaClient = defaultPrisma,
): Promise<boolean> {
  try {
    return (await getActiveIllnessEpisodes(userId, asOf, client)).length > 0;
  } catch {
    return false;
  }
}
