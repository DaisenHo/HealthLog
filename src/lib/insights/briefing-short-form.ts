/**
 * v1.43 (#1217) — the daily briefing's short form, for the `frugal` AI usage
 * level.
 *
 * The person chose the level knowingly, so a shorter briefing is fine there:
 * the lead and today, at most one recommendation, no trend or storyboard
 * annotations. The contract keeps its shape on every level: every required
 * field stays present (`recommendations` is decoded as a required array by
 * the native client), only shorter. `standard` and `full` keep the full
 * contract, recommendations included.
 *
 * The prompt asks for the short form; {@link applyBriefingShortForm} holds the
 * counts afterwards, so a model that writes more than asked cannot widen it.
 */
import { instructionLocale } from "@/lib/ai/prompts/output-language";
import { loadRecordUsageLevel } from "@/lib/ai/capabilities/usage";
import {
  AI_USAGE_LEVEL_EFFECTS,
  DEFAULT_AI_USAGE_DEFAULT_LEVEL,
} from "@/lib/ai/usage-level";
import type { Locale } from "@/lib/i18n/config";

export type BriefingForm = "full" | "short";

/** At most this many entries of each list on the short form. */
export const SHORT_FORM_LIMITS = Object.freeze({
  recommendations: 1,
  signalsOfDay: 2,
  keyFindings: 2,
});

/**
 * The briefing form for one record's level. An unreadable level reads as the
 * instance default's form.
 */
export async function briefingFormForRecord(
  recordId: string,
): Promise<BriefingForm> {
  try {
    return AI_USAGE_LEVEL_EFFECTS[await loadRecordUsageLevel(recordId)]
      .briefing;
  } catch {
    return AI_USAGE_LEVEL_EFFECTS[DEFAULT_AI_USAGE_DEFAULT_LEVEL].briefing;
  }
}

/**
 * The block appended to the briefing's user prompt on the short form. Empty
 * for the full form, so a `standard` or `full` prompt is unchanged.
 */
export function buildBriefingShortFormBlock(
  locale: Locale,
  form: BriefingForm,
): string {
  if (form === "full") return "";
  if (instructionLocale(locale) === "de") {
    return `

KURZFORM (vom Nutzer gewählte sparsame KI-Stufe)
Schreibe dieselbe JSON-Struktur mit allen Pflichtfeldern, nur kürzer:
- "summary": ein bis zwei Sätze.
- "dailyBriefing.paragraph": 40 bis 80 Wörter, ein Absatz: das Urteil des Tages und was es für heute heißt.
- "dailyBriefing.signalsOfDay": höchstens ${SHORT_FORM_LIMITS.signalsOfDay}; "dailyBriefing.keyFindings": höchstens ${SHORT_FORM_LIMITS.keyFindings}.
- "recommendations": höchstens ${SHORT_FORM_LIMITS.recommendations}, die wichtigste; ein leeres Array, wenn nichts ansteht.
- "trendAnnotations" und "storyboardAnnotations" weglassen.
Alle übrigen Regeln gelten unverändert.`;
  }
  return `

SHORT FORM (the person chose the frugal AI usage level)
Write the same JSON structure with every required field, only shorter:
- "summary": one or two sentences.
- "dailyBriefing.paragraph": 40 to 80 words, one paragraph: the day's verdict and what it means for today.
- "dailyBriefing.signalsOfDay": at most ${SHORT_FORM_LIMITS.signalsOfDay}; "dailyBriefing.keyFindings": at most ${SHORT_FORM_LIMITS.keyFindings}.
- "recommendations": at most ${SHORT_FORM_LIMITS.recommendations}, the most important one; an empty array when nothing is due.
- Leave out "trendAnnotations" and "storyboardAnnotations".
Every other rule still applies.`;
}

/**
 * Hold a parsed briefing payload to the short form's counts. Pure: returns a
 * copy, every field still present. A payload that is not an object comes
 * back as it was.
 */
export function applyBriefingShortForm<T>(payload: T): T {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...(payload as Record<string, unknown>) };
  if (Array.isArray(out.recommendations)) {
    out.recommendations = out.recommendations.slice(
      0,
      SHORT_FORM_LIMITS.recommendations,
    );
  }
  delete out.trendAnnotations;
  delete out.storyboardAnnotations;
  const briefing = out.dailyBriefing;
  if (briefing && typeof briefing === "object") {
    const b = { ...(briefing as Record<string, unknown>) };
    if (Array.isArray(b.signalsOfDay)) {
      b.signalsOfDay = b.signalsOfDay.slice(0, SHORT_FORM_LIMITS.signalsOfDay);
    }
    if (Array.isArray(b.keyFindings)) {
      b.keyFindings = b.keyFindings.slice(0, SHORT_FORM_LIMITS.keyFindings);
    }
    out.dailyBriefing = b;
  }
  return out as T;
}
