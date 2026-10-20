/**
 * The Coach preference values a client component needs, without the schema
 * library: the data clusters, the cluster and preference defaults, the
 * reasoning-level reader. `src/lib/validations/coach-prefs.ts` builds its zod
 * schemas from these and re-exports them for server code.
 */
import {
  DEFAULT_REASONING_LEVEL,
  type ReasoningLevel,
} from "@/lib/ai/reasoning/levels";
import type { CoachPrefs } from "@/lib/validations/coach-prefs";

/**
 * The data clusters the Coach may read. The Coach applies the selected
 * clusters when a turn does not carry an explicit `scope.sources` list, then
 * subtracts `excludeMetrics` as a post-filter.
 */
export const COACH_DATA_CLUSTERS = [
  "cardio",
  "body",
  "activity",
  "workouts",
  "sleep",
  "mood",
  "glucose",
  "medication",
  "mobility",
  "environment",
] as const;
export type CoachDataCluster = (typeof COACH_DATA_CLUSTERS)[number];

/**
 * Clusters enabled when the user has never touched the cluster picker
 * (`dataClusters === undefined`). These four reproduce today's legacy
 * five domains: cardio carries BP + pulse, body carries weight, mood
 * and medication map straight through. The additive members riding
 * inside cardio/body (HRV, resting HR, body-composition) only surface
 * when the user actually has rows for them — empty blocks are dropped —
 * so a web-only account stays close to the legacy 5-domain output while
 * an iOS account quietly gains the extra signals it already stores.
 */
export const DEFAULT_COACH_CLUSTERS: ReadonlyArray<CoachDataCluster> = [
  "cardio",
  "body",
  "mood",
  "medication",
];

/**
 * Default preferences applied when the user has never opened the
 * settings cog. Equivalent to `coachPrefsSchema.parse({})` but
 * returned as a plain object so call sites can compare references
 * (e.g., short-circuit a snapshot rebuild when prefs match defaults).
 */
export const DEFAULT_COACH_PREFS: CoachPrefs = {
  tone: "warm",
  verbosity: "default",
  excludeMetrics: [],
  showEvidenceByDefault: false,
  defaultWindow: "allTime",
};

/** The person's reasoning level; an absent key is the default, `medium`. */
export function coachReasoningLevel(prefs: CoachPrefs): ReasoningLevel {
  return prefs.reasoning ?? DEFAULT_REASONING_LEVEL;
}
