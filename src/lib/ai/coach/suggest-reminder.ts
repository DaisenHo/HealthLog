/**
 * v1.18.1 — Coach cadence suggestions.
 *
 * The Coach can append a `---SUGGEST-REMINDER---` … `---END---` sentinel
 * block to its reply when an evidence-based measurement cadence is worth
 * proposing (a new/changed med, erratic readings, a fast trend, a target
 * off-track, or a measurement gap). The route strips the block out of the
 * prose — exactly like the `---KEYVALUES---` evidence block — parses one
 * cadence id out of it, validates it against the closed CADENCE_CATALOG,
 * and emits an ADDITIVE `suggestion` SSE frame the client renders as a
 * one-tap action card. Accepting the card POSTs to
 * `POST /api/measurement-reminders` with `origin: COACH`; the SERVER
 * resolves the actual cadence (intervalDays / rrule / endsOn) — the model
 * only names the metric + the preset.
 *
 * Why a closed catalog and not free-form cadence fields from the model:
 *   - Evidence-based cadences ONLY. The model picks from a fixed set
 *     grounded in ESH/AHA + general consistency guidance; it cannot mint a
 *     "measure your BP 6×/day" nag.
 *   - Server-authoritative scheduling. The reminder rows are computed by
 *     the same recurrence engine the Vorsorge surface uses; web ↔ iOS read
 *     identical numbers.
 *
 * Defence-in-depth mirrors `keyvalues.ts`: 512-byte cap, one cadence id
 * kept, validated against the catalog, malformed → dropped (no card).
 */
import type { MeasurementReminderType } from "@/lib/validations/measurement-reminders";

const OPEN_SENTINEL = "---SUGGEST-REMINDER---";
const CLOSE_SENTINEL = "---END---";
/** Hard cap on the sentinel payload before parsing (prompt-injection guard). */
const SENTINEL_BYTE_CAP = 512;

/**
 * A cadence the Coach may propose. `id` is the stable token the model
 * emits; everything else is server-owned so the model cannot widen a
 * cadence or invent a metric.
 *
 * `measurementType` is the auto-resolve target the reminder row carries
 * (the eventful engine advances `lastSatisfiedAt` when a matching reading
 * lands). `module` is the module-gate key that must be enabled for the
 * suggestion to surface — disabled module ⇒ no suggestion.
 *
 * Exactly one of `intervalDays` / `rrule` is set, matching the reminder
 * create contract. `courseDays`, when set, bounds a finite course window
 * (`endsOn = now + courseDays`) for cadences that are deliberately
 * time-boxed (the ESH/AHA 7-day BP protocol).
 */
export interface CadencePreset {
  id: string;
  measurementType: MeasurementReminderType;
  /** Module-gate key; null ⇒ a core domain (never gated). */
  module: "glucose" | null;
  intervalDays: number | null;
  rrule: string | null;
  /** Finite course window in days; null ⇒ open-ended cadence. */
  courseDays: number | null;
  /** i18n key for the action-card label ("Measure your BP twice daily…"). */
  labelKey: string;
  /** Notify hour default (0–23). Mirrors the reminder create default. */
  notifyHour: number;
}

/**
 * The closed catalog. Evidence-based cadences only:
 *   - weight: daily consistency (a stable cadence beats sporadic spikes).
 *   - bp_7_2_2: ESH/AHA home-BP protocol — twice daily, morning + evening,
 *     for 7 days. Time-boxed (courseDays:7) so it self-expires.
 *   - glucose_structured: structured testing on a daily cadence (only when
 *     the glucose module is enabled).
 *
 * Deliberately NOT here: RHR / HRV (passive nightly samples — the Coach
 * surfaces the baseline, it does not nudge "go measure" them). See the
 * Workstream-C plan.
 */
export const CADENCE_CATALOG: Readonly<Record<string, CadencePreset>> =
  Object.freeze({
    weight_daily: {
      id: "weight_daily",
      measurementType: "WEIGHT",
      module: null,
      intervalDays: 1,
      rrule: null,
      courseDays: null,
      labelKey: "coach.reminderSuggestion.cadence.weightDaily",
      notifyHour: 8,
    },
    bp_7_2_2: {
      id: "bp_7_2_2",
      measurementType: "BLOOD_PRESSURE_SYS",
      module: null,
      // Twice daily, morning + evening, on a finite 7-day course (ESH/AHA).
      intervalDays: null,
      rrule: "FREQ=DAILY;BYHOUR=7,19;INTERVAL=1",
      courseDays: 7,
      labelKey: "coach.reminderSuggestion.cadence.bp722",
      notifyHour: 7,
    },
    glucose_structured: {
      id: "glucose_structured",
      measurementType: "BLOOD_GLUCOSE",
      module: "glucose",
      intervalDays: 1,
      rrule: null,
      courseDays: null,
      labelKey: "coach.reminderSuggestion.cadence.glucoseStructured",
      notifyHour: 8,
    },
  });

export type CadenceId = keyof typeof CADENCE_CATALOG;

/** True for a string the model emitted that names a real catalog cadence. */
export function isCadenceId(value: string): value is CadenceId {
  return Object.prototype.hasOwnProperty.call(CADENCE_CATALOG, value);
}

/**
 * Result of stripping the `---SUGGEST-REMINDER---` block out of a reply.
 *
 * `prose` is the reply with the block removed (the KEYVALUES strip runs
 * first; this strips what remains). `cadence` is the resolved preset when
 * the model named a valid, in-catalog cadence; `null` otherwise (no block,
 * malformed block, or an unknown cadence id — all degrade to "no card").
 */
export interface SuggestReminderParseResult {
  prose: string;
  cadence: CadencePreset | null;
  /** True when an opening sentinel was seen but yielded no valid cadence. */
  malformed: boolean;
}

/**
 * Parse one body line of the sentinel block. The contract is a single
 * `cadence: <id>` line (extra lines are ignored). We tolerate the model
 * emitting a `reason:` line too — it is informational and dropped.
 */
function extractCadenceId(body: string): string | null {
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    if (key !== "cadence") continue;
    const value = line
      .slice(colon + 1)
      .trim()
      // Strip surrounding quotes / backticks the model sometimes adds.
      .replace(/^["'`]|["'`]$/g, "");
    if (value) return value;
  }
  return null;
}

/**
 * Split a reply into `{ prose, cadence }`, stripping the
 * `---SUGGEST-REMINDER---` block. Run this AFTER `parseKeyValuesSentinel`
 * so the prose it receives is already free of the evidence block.
 */
export function parseSuggestReminder(raw: string): SuggestReminderParseResult {
  if (!raw) return { prose: "", cadence: null, malformed: false };

  const openIdx = raw.indexOf(OPEN_SENTINEL);
  if (openIdx === -1) {
    return { prose: raw, cadence: null, malformed: false };
  }

  const before = raw.slice(0, openIdx);
  const afterOpen = raw.slice(openIdx + OPEN_SENTINEL.length);
  const closeRel = afterOpen.indexOf(CLOSE_SENTINEL);
  // Cap the payload before parsing regardless of whether the close marker
  // is present (a missing close marker treats the rest as the body).
  const bodyRaw = closeRel === -1 ? afterOpen : afterOpen.slice(0, closeRel);
  const body =
    bodyRaw.length > SENTINEL_BYTE_CAP
      ? bodyRaw.slice(0, SENTINEL_BYTE_CAP)
      : bodyRaw;

  // Reconstruct the prose as text-before-open + text-after-close so a model
  // that writes a sentence AFTER the block (or after a malformed one) keeps
  // it. Only the sentinel block itself is stripped; when the close marker is
  // missing there is no trailing text to recover.
  const after =
    closeRel === -1 ? "" : afterOpen.slice(closeRel + CLOSE_SENTINEL.length);
  const prose = `${before}${after}`.replace(/^\s+|\s+$/gu, "");

  const cadenceId = extractCadenceId(body);
  if (cadenceId && isCadenceId(cadenceId)) {
    return { prose, cadence: CADENCE_CATALOG[cadenceId], malformed: false };
  }
  // Opening sentinel present but no valid cadence — strip the block from
  // the prose (the user must never see the raw marker) and flag malformed.
  return { prose, cadence: null, malformed: true };
}
