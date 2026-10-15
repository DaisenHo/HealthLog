/**
 * v1.43 (#1217) — AI usage in three levels.
 *
 * One setting per account instead of many knobs. The operator sets the highest
 * level an account may choose (`maxLevel`) and the level an account without a
 * choice runs at (`defaultLevel`), since the operator pays for the shared key;
 * each person picks within that. A level decides how much background model
 * work the account asks for. It never decides what data is stored or shown,
 * and the interactive Coach is the same at every level (its own budget caps
 * apply as before).
 *
 * This file is the vocabulary: the levels, what each one does, the resolver
 * and the estimate. Pure, no I/O, so the account payload, the jobs, the
 * routes, the admin readout and the tests all read the same table. The reads
 * live in `./capabilities/usage.ts`.
 *
 * Wire spelling is lower case (`frugal` / `standard` / `full`); the database
 * enum (`AiUsageLevel`) is upper case. {@link AI_USAGE_LEVELS} is the ceiling
 * order: a level is allowed when it is at or below `maxLevel`.
 */
import {
  AI_USAGE_LEVELS,
  type AiUsageLevelWire,
} from "@/lib/validations/ai-usage";

export { AI_USAGE_LEVELS };
export type AiUsageLevel = AiUsageLevelWire;

/**
 * Where the effective level comes from:
 *
 *   - `user`: the account's own stored choice;
 *   - `default`: no stored choice, so the operator's default;
 *   - `admin_cap`: a stored choice above the operator's ceiling, capped at
 *     read time. The choice itself is kept, so raising the ceiling again
 *     restores it.
 */
export const AI_USAGE_SOURCES = ["user", "default", "admin_cap"] as const;
export type AiUsageSource = (typeof AI_USAGE_SOURCES)[number];

/** What one level does. Every effect a level has is a row here. */
export interface AiUsageLevelEffect {
  /**
   * Minimum hours between two status-card regenerations of one scope after a
   * sync (a watch, an integration). `"instance"` reads the operator's sync
   * gap (`AppSettings.aiSyncRegenGapHours`, else `AI_SYNC_REGEN_GAP_HOURS`,
   * else six).
   */
  syncRegenGapHours: number | "instance";
  /** The same gap after a hand entry. */
  manualRegenGapHours: number;
  /**
   * The status snapshot's char cap, measured on the compact JSON the prompt
   * ships (`degradeStatusSnapshotToBudget`). Fourteen thousand holds every
   * snapshot that fitted the old 24 000 pretty-printed characters.
   */
  statusSnapshotChars: number;
  /**
   * Whether the background jobs that may reason (the briefing, the period
   * narratives, the Coach memory) ask for it. When true the job's own level
   * applies (`BACKGROUND_REASONING_LEVEL`), still capped by the operator.
   */
  backgroundReasoning: boolean;
  /**
   * The daily briefing's form. `short`: the lead plus today, at most one
   * recommendation; every field of the contract stays present, so a client
   * decodes it unchanged.
   */
  briefing: "full" | "short";
  /**
   * Whether the account's own "read documents automatically" setting may
   * act. When false, documents are read on request only.
   */
  documentsAutoRead: boolean;
  /**
   * Relative token use, `full` = 1. Scales the measured use of the effective
   * level into an estimate for another level. Calibrated with the generation
   * simulation of a watch-synced account
   * (`src/lib/insights/__tests__/usage-level-simulation.test.ts`): status-card
   * generations a day, the nightly warm included, are 141 on `full`, 44 on
   * `standard` (0.31) and 21 on `frugal` (0.15, before its shorter briefing
   * and switched-off reasoning). The Coach is part of the measured use and
   * does not scale, so the result is published and shown as an estimate.
   */
  tokenFactor: number;
}

export const AI_USAGE_LEVEL_EFFECTS: Readonly<
  Record<AiUsageLevel, Readonly<AiUsageLevelEffect>>
> = Object.freeze({
  frugal: {
    syncRegenGapHours: 24,
    manualRegenGapHours: 6,
    statusSnapshotChars: 10_000,
    backgroundReasoning: false,
    briefing: "short",
    documentsAutoRead: false,
    tokenFactor: 0.15,
  },
  standard: {
    syncRegenGapHours: "instance",
    manualRegenGapHours: 1,
    statusSnapshotChars: 14_000,
    backgroundReasoning: true,
    briefing: "full",
    documentsAutoRead: true,
    tokenFactor: 0.3,
  },
  full: {
    syncRegenGapHours: 1,
    manualRegenGapHours: 1,
    statusSnapshotChars: 14_000,
    backgroundReasoning: true,
    briefing: "full",
    documentsAutoRead: true,
    tokenFactor: 1,
  },
});

/** The instance's own defaults, before an operator changes anything. */
export const DEFAULT_AI_USAGE_MAX_LEVEL: AiUsageLevel = "standard";
export const DEFAULT_AI_USAGE_DEFAULT_LEVEL: AiUsageLevel = "standard";

// ── Order ───────────────────────────────────────────────────────────────────

export function usageLevelRank(level: AiUsageLevel): number {
  return AI_USAGE_LEVELS.indexOf(level);
}

/** Whether `level` is at or above `min`. */
export function usageLevelAtLeast(
  level: AiUsageLevel,
  min: AiUsageLevel,
): boolean {
  return usageLevelRank(level) >= usageLevelRank(min);
}

/** `level`, lowered to `max` when it lies above it. */
export function capUsageLevel(
  level: AiUsageLevel,
  max: AiUsageLevel,
): AiUsageLevel {
  return usageLevelRank(level) > usageLevelRank(max) ? max : level;
}

export function isAiUsageLevel(value: unknown): value is AiUsageLevel {
  return (
    typeof value === "string" &&
    (AI_USAGE_LEVELS as readonly string[]).includes(value)
  );
}

// ── Database spelling ───────────────────────────────────────────────────────

export type AiUsageLevelDb = "FRUGAL" | "STANDARD" | "FULL";

export function usageLevelFromDb(
  value: string | null | undefined,
): AiUsageLevel | null {
  if (value == null) return null;
  const lower = value.toLowerCase();
  return isAiUsageLevel(lower) ? lower : null;
}

export function usageLevelToDb(level: AiUsageLevel): AiUsageLevelDb {
  return level.toUpperCase() as AiUsageLevelDb;
}

// ── Resolution ──────────────────────────────────────────────────────────────

export interface AiUsageBounds {
  /** The account's stored choice; `null` follows the default. */
  preference: AiUsageLevel | null;
  defaultLevel: AiUsageLevel;
  maxLevel: AiUsageLevel;
}

export interface AiUsageResolution {
  level: AiUsageLevel;
  source: AiUsageSource;
}

/**
 * The level in effect. A stored choice at or below the ceiling wins; above it
 * the ceiling applies and the choice is kept (`admin_cap`). Without a choice
 * the default applies, held to the ceiling too, so a default stored above
 * the ceiling (the admin route refuses one, an old row might hold one) can
 * never lift an account over it.
 */
export function resolveAiUsageLevel(bounds: AiUsageBounds): AiUsageResolution {
  const { preference, defaultLevel, maxLevel } = bounds;
  if (preference === null) {
    return { level: capUsageLevel(defaultLevel, maxLevel), source: "default" };
  }
  if (usageLevelRank(preference) > usageLevelRank(maxLevel)) {
    return { level: maxLevel, source: "admin_cap" };
  }
  return { level: preference, source: "user" };
}

// ── Effects ─────────────────────────────────────────────────────────────────

/** Where a batch of fresh measurements came from (`status-invalidation.ts`). */
export type IngestSource = "manual" | "sync";

/** Default sync gap when neither the operator nor the environment sets one. */
export const DEFAULT_SYNC_REGEN_GAP_HOURS = 6;
export const SYNC_REGEN_GAP_HOURS_MIN = 1;
export const SYNC_REGEN_GAP_HOURS_MAX = 48;

/** A sync gap in whole hours, or `null` when the value is not a usable one. */
export function parseSyncRegenGapHours(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isInteger(n)) return null;
  if (n < SYNC_REGEN_GAP_HOURS_MIN || n > SYNC_REGEN_GAP_HOURS_MAX) return null;
  return n;
}

/**
 * Hours a scope waits after its last regeneration before an ingest of this
 * source may regenerate it again.
 *
 * @param instanceSyncGapHours The operator's resolved sync gap, read by
 *   `standard`.
 */
export function statusRegenGapHours(
  level: AiUsageLevel,
  source: IngestSource,
  instanceSyncGapHours: number,
): number {
  const effect = AI_USAGE_LEVEL_EFFECTS[level];
  if (source === "manual") return effect.manualRegenGapHours;
  return effect.syncRegenGapHours === "instance"
    ? instanceSyncGapHours
    : effect.syncRegenGapHours;
}

// ── Estimate ────────────────────────────────────────────────────────────────

/** Full days behind the measured mean, at most. */
export const AI_USAGE_MEASURE_DAYS = 7;
/** Days of history an estimate needs. */
export const AI_USAGE_ESTIMATE_MIN_DAYS = 3;

/**
 * Tokens per day at `target`, scaled from what the account used at `from`.
 * `null` without enough history.
 */
export function estimateTokensPerDay(args: {
  measuredTokensPerDay: number | null;
  measuredDays: number;
  from: AiUsageLevel;
  target: AiUsageLevel;
}): number | null {
  if (args.measuredTokensPerDay === null) return null;
  if (args.measuredDays < AI_USAGE_ESTIMATE_MIN_DAYS) return null;
  const ratio =
    AI_USAGE_LEVEL_EFFECTS[args.target].tokenFactor /
    AI_USAGE_LEVEL_EFFECTS[args.from].tokenFactor;
  return Math.round(args.measuredTokensPerDay * ratio);
}

/** `ai.usage` on `GET /api/auth/me` (OpenAPI `AiUsageState`). */
export interface AiUsageState {
  level: AiUsageLevel;
  preference: AiUsageLevel | null;
  defaultLevel: AiUsageLevel;
  maxLevel: AiUsageLevel;
  source: AiUsageSource;
  options: Array<{
    level: AiUsageLevel;
    allowed: boolean;
    estimatedTokensPerDay: number | null;
  }>;
  measuredTokensPerDay: number | null;
  measuredDays: number;
}

/** The whole published state, from the bounds and the measured use. */
export function buildAiUsageState(
  args: AiUsageBounds & {
    measuredTokensPerDay: number | null;
    measuredDays: number;
  },
): AiUsageState {
  const { level, source } = resolveAiUsageLevel(args);
  return {
    level,
    preference: args.preference,
    defaultLevel: args.defaultLevel,
    maxLevel: args.maxLevel,
    source,
    options: AI_USAGE_LEVELS.map((option) => ({
      level: option,
      allowed: usageLevelRank(option) <= usageLevelRank(args.maxLevel),
      estimatedTokensPerDay: estimateTokensPerDay({
        measuredTokensPerDay: args.measuredTokensPerDay,
        measuredDays: args.measuredDays,
        from: level,
        target: option,
      }),
    })),
    measuredTokensPerDay: args.measuredTokensPerDay,
    measuredDays: args.measuredDays,
  };
}
