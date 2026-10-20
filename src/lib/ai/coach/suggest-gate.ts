/**
 * v1.18.1 — the non-naggy gate for Coach cadence
 * suggestions.
 *
 * The model can PROPOSE a cadence (the `---SUGGEST-REMINDER---` sentinel);
 * this module is the SERVER's decision on whether that proposal actually
 * surfaces as an action card. It is the first of the TRIPLE dedup:
 *
 *   1. SUGGEST gate (here): module-toggle + opt-out/stop + dismissal
 *      memory + cooldown + dedup against a live COACH reminder for the
 *      metric. A proposal that fails any of these is dropped silently — no
 *      `suggestion` frame.
 *   2. RENDER (client): the card renders once per assistant message.
 *   3. CREATE (`POST /api/measurement-reminders`): the create path refuses
 *      a second live COACH reminder for the same metric (a re-tap or a
 *      stale card cannot double-create).
 *
 * Pure decision functions + one DB-reading orchestrator so the gate logic
 * is unit-testable without a database.
 */
import type { PrismaClient } from "@/generated/prisma/client";
import type { CadencePreset } from "./suggest-reminder";
import type { CoachReminderSuggestionPrefs } from "@/lib/validations/coach-prefs";
import { DEFAULT_REMINDER_SUGGESTION_PREFS } from "@/lib/validations/coach-prefs";
import { isModuleEnabled } from "@/lib/modules/gate";

/**
 * Cooldown between two cadence suggestions. A frequency cap, not a
 * per-cadence cap: once the Coach suggested anything, it stays quiet for
 * this window regardless of which cadence comes up next, so a chatty
 * session never stacks cards.
 */
export const SUGGESTION_COOLDOWN_DAYS = 14;
const SUGGESTION_COOLDOWN_MS = SUGGESTION_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;

/** Why a proposal was suppressed (annotation meta; never user-facing). */
export type SuggestionSuppressReason =
  | "disabled"
  | "stopped"
  | "dismissed"
  | "cooldown"
  | "module_disabled"
  | "duplicate";

export type SuggestionDecision =
  { surface: true } | { surface: false; reason: SuggestionSuppressReason };

/**
 * Pure pref-level decision (no DB). Applies opt-out, the explicit stop
 * path, dismissal memory, and the cooldown. The caller layers the
 * module-toggle + dedup checks (which need a DB) on top.
 */
export function decideFromPrefs(
  prefs: CoachReminderSuggestionPrefs,
  cadenceId: string,
  now: Date,
): SuggestionDecision {
  if (!prefs.enabled) return { surface: false, reason: "disabled" };
  if (prefs.stopped) return { surface: false, reason: "stopped" };
  if (prefs.dismissedCadences.includes(cadenceId)) {
    return { surface: false, reason: "dismissed" };
  }
  if (prefs.lastSuggestedAt) {
    const last = new Date(prefs.lastSuggestedAt).getTime();
    if (
      Number.isFinite(last) &&
      now.getTime() - last < SUGGESTION_COOLDOWN_MS
    ) {
      return { surface: false, reason: "cooldown" };
    }
  }
  return { surface: true };
}

/**
 * Full gate: pref decision, then the module-toggle, then dedup against a
 * live COACH reminder for the cadence's metric. Returns the surface
 * decision; the route emits the `suggestion` frame only when
 * `surface === true` and stamps `lastSuggestedAt` so the cooldown starts.
 */
export async function gateSuggestion(args: {
  prisma: PrismaClient;
  userId: string;
  cadence: CadencePreset;
  prefs?: CoachReminderSuggestionPrefs;
  now?: Date;
}): Promise<SuggestionDecision> {
  const prefs = args.prefs ?? DEFAULT_REMINDER_SUGGESTION_PREFS;
  const now = args.now ?? new Date();

  const prefDecision = decideFromPrefs(prefs, args.cadence.id, now);
  if (!prefDecision.surface) return prefDecision;

  // Module-toggle: a cadence for a disabled module never surfaces. Core
  // domains (`module: null`) are always available.
  if (args.cadence.module) {
    const enabled = await isModuleEnabled(args.userId, args.cadence.module);
    if (!enabled) return { surface: false, reason: "module_disabled" };
  }

  // Dedup: a live (non-deleted) COACH reminder for the same metric means
  // the user already accepted this cadence — never suggest it again.
  const existing = await args.prisma.measurementReminder.findFirst({
    where: {
      userId: args.userId,
      origin: "COACH",
      measurementType: args.cadence.measurementType,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (existing) return { surface: false, reason: "duplicate" };

  return { surface: true };
}
