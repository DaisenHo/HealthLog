/**
 * v1.18.10 — period-narrative grounding validator.
 *
 * The period narrative was plain text written straight to storage after the
 * provider call, with NO post-generation check and NO corrective retry —
 * unlike Comprehensive Insights, which rejects + retries + 422s on a grounding
 * miss. The system prompt bans causal language and forbids stating a number
 * not in the context, but those are instructions, not enforcement: a populated
 * (non-`insufficient`) context could still yield "stress is the likely
 * culprit" or a figure absent from the context block, and nothing rejected it.
 *
 * This module is the missing gate. Given the generated text and the structured
 * `PeriodNarrativeContext`, it flags:
 *   1. causal phrasing ("because", "caused", "due to", "weil", "wegen", …);
 *   2. any number the narrative states that does not trace to a context figure
 *      within a rounding tolerance.
 * The generator runs it after the completion, retries ONCE with a corrective
 * suffix on a trip, and falls back to NO narrative (writes nothing) rather than
 * persisting an ungrounded story.
 *
 * Pure + side-effect-free, so it unit-tests in isolation.
 */
import type { PeriodNarrativeContext } from "@/lib/insights/narrative/period-narrative";
import type { Locale } from "@/lib/i18n/config";
import {
  screenModelOutput,
  INSIGHTS_CONTRACTS,
} from "@/lib/ai/safety/outbound-screen";

/** Absolute + relative number-match tolerance (rounding slack). */
const ABS_TOLERANCE = 0.15;
const REL_TOLERANCE = 0.02;

/**
 * The causal bank used to live here as an EN + DE list, which meant GROUND
 * RULE 12 was enforced in code on this one surface and only for two of the six
 * locales it ships in. It now comes from the shared screen, which carries all
 * six — so a French or Polish narrative asserting causation is caught the same
 * way a German one always was. The screen also adds the dose and risk-score
 * contracts, which this surface never checked at all: the narrative is
 * persisted prose and a dose imperative in it is as unsafe as one in the Coach.
 */
export type NarrativeGroundingReason =
  "causal_language" | "ungrounded_number" | "dose_prescription" | "risk_score";

export interface NarrativeGroundingFinding {
  reason: NarrativeGroundingReason;
  /** The matched token (truncated). */
  source: string;
}

/** Parse every standalone number out of free text (`.`/`,` decimals). */
function extractNumbers(text: string): Array<{ value: number; raw: string }> {
  const out: Array<{ value: number; raw: string }> = [];
  const re = /[+-]?\d+(?:[.,]\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const value = Number.parseFloat(raw.replace(",", "."));
    if (Number.isFinite(value)) out.push({ value, raw });
  }
  return out;
}

/** Every authoritative magnitude the context exposes (signed + absolute). */
function authoritativeValues(context: PeriodNarrativeContext): number[] {
  const values: number[] = [];
  const push = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isFinite(n)) {
      values.push(n);
      values.push(Math.abs(n));
    }
  };
  for (const d of context.metricDeltas) {
    push(d.current);
    push(d.prior);
    push(d.delta);
    push(d.deltaPercent);
    push(d.currentDays);
    push(d.priorDays);
  }
  for (const b of context.bandTransitions) {
    push(b.center);
    push(b.bandLow);
    push(b.bandHigh);
    push(b.baselineDays);
  }
  for (const dr of context.drivers) {
    push(dr.r);
    push(dr.qValue);
    push(dr.n);
  }
  push(context.pairsTested);
  push(context.fdrQ);
  return values;
}

function isGrounded(value: number, authoritative: readonly number[]): boolean {
  for (const a of authoritative) {
    const tol = Math.max(ABS_TOLERANCE, Math.abs(a) * REL_TOLERANCE);
    if (Math.abs(value - a) <= tol) return true;
  }
  return false;
}

/**
 * Structural integers the narrative may state without a context match — small
 * ordinals and the literal period lengths the prompt references (7 / 30 days).
 */
const STRUCTURAL_INTEGERS = new Set([7, 30]);

function isStructural(value: number, raw: string): boolean {
  if (raw.includes(".") || raw.includes(",")) return false;
  if (!Number.isInteger(value)) return false;
  const abs = Math.abs(value);
  if (abs <= 3) return true;
  return STRUCTURAL_INTEGERS.has(abs);
}

/**
 * Validate a generated narrative against its context. Returns every grounding
 * violation found; an empty array means the narrative is grounded and
 * causally-clean.
 */
export function validateNarrativeText(
  text: string,
  context: PeriodNarrativeContext,
  locale: Locale,
): NarrativeGroundingFinding[] {
  const findings: NarrativeGroundingFinding[] = [];
  if (typeof text !== "string" || text.trim().length === 0) return findings;

  const screened = screenModelOutput(text, locale, INSIGHTS_CONTRACTS);
  if (screened.block && screened.reason) {
    findings.push({
      reason:
        screened.reason === "causal_claim"
          ? "causal_language"
          : screened.reason,
      source: screened.reason,
    });
  }

  const authoritative = authoritativeValues(context);
  for (const { value, raw } of extractNumbers(text)) {
    if (isStructural(value, raw)) continue;
    if (isGrounded(value, authoritative)) continue;
    findings.push({ reason: "ungrounded_number", source: raw.slice(0, 32) });
  }

  return findings;
}

/**
 * Corrective suffix appended to the user prompt on the single retry, naming the
 * violations so the model can self-correct — mirroring the comprehensive
 * insight's `buildRetryCorrectionMessage` posture.
 */
export function buildNarrativeCorrection(
  findings: readonly NarrativeGroundingFinding[],
  locale: "de" | "en",
): string {
  const causal = findings.some((f) => f.reason === "causal_language");
  const numbers = findings
    .filter((f) => f.reason === "ungrounded_number")
    .slice(0, 6)
    .map((f) => f.source)
    .join(", ");
  if (locale === "de") {
    const parts = [
      "Deine vorige Zusammenfassung hat die festen Regeln verletzt.",
    ];
    if (causal) {
      parts.push(
        "Sie enthielt URSÄCHLICHE Formulierungen. Schreibe ausschließlich BESCHREIBEND ('X bewegte sich mit Y', 'X war mit Y assoziiert') — nie 'weil', 'wegen', 'verursacht', 'führte zu'.",
      );
    }
    if (numbers) {
      parts.push(
        `Sie nannte Zahlen, die NICHT im Kontext stehen: ${numbers}. Nenne nur Zahlen, die wörtlich im KONTEXT vorkommen, oder lass die Zahl weg.`,
      );
    }
    parts.push("Schreibe die Zusammenfassung erneut (2–4 kurze Sätze).");
    return `\n\n${parts.join(" ")}`;
  }
  const parts = ["Your previous summary broke the hard rules."];
  if (causal) {
    parts.push(
      "It used CAUSAL wording. Write strictly DESCRIPTIVELY ('X moved with Y', 'X was associated with Y') — never 'because', 'due to', 'caused', 'led to'.",
    );
  }
  if (numbers) {
    parts.push(
      `It stated numbers NOT in the context: ${numbers}. State only numbers that appear verbatim in the CONTEXT, or drop the number.`,
    );
  }
  parts.push("Re-write the summary (2-4 short sentences).");
  return `\n\n${parts.join(" ")}`;
}
