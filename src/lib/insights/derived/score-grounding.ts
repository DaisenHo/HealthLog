/**
 * v1.22 — number-grounding gate for the AI-warmed SCORE assessment.
 *
 * The per-score AI text (`derived-assessment-ai.ts`) rode the base-system
 * prompt but had NO post-generation number verifier — unlike the briefing
 * (`briefing-grounding.ts`) and the Coach (`coach-prose-grounding.ts`). The
 * v1.22 score rewrite enriches the prose (a band→meaning interpretation, both
 * the helped + hurt contributors), which is exactly when a fabricated figure
 * could slip in. This gate closes that: the only numbers the score prose may
 * state are the score itself and its contributor values (each a 0–100), all
 * already present on the `MetricSignal`. A miss does NOT block — the caller
 * falls back to the always-grounded deterministic text, keeping the locked iOS
 * `assessment: {text, source, updatedAt}` contract non-empty.
 *
 * It grades NUMBERS only (reusing the briefing verifier's `extractNumbers` +
 * tolerance basis); tone / framing stay the prompt's job. The band→meaning
 * mapping carries no number, so it cannot be flagged here — and because that
 * mapping is a closed deterministic table in the deterministic fallback, the
 * interpretation can never hallucinate a verdict either.
 */
import { extractNumbers } from "@/lib/ai/briefing-grounding";
import type { MetricSignal } from "@/lib/insights/metric-signal";

/** Same tolerance basis as the briefing + Coach verifiers. */
const ABS_TOLERANCE = 0.15;
const REL_TOLERANCE = 0.02;

/** Window lengths + small ordinals the prose uses structurally. */
const STRUCTURAL_INTEGERS = new Set([7, 14, 30, 31, 90, 100, 365]);

function isStructural(value: number, raw: string): boolean {
  if (raw.includes(".") || raw.includes(",")) return false;
  if (!Number.isInteger(value)) return false;
  const abs = Math.abs(value);
  if (abs <= 3) return true;
  // 100 is the score denominator ("64 out of 100"); always allowed.
  return STRUCTURAL_INTEGERS.has(abs);
}

/** One score-prose number that traces to no authoritative score figure. */
export interface UngroundedScoreNumber {
  value: number;
  source: string;
}

/**
 * The authoritative magnitudes a score assessment may state: the score itself,
 * its signed/absolute delta, and every contributor value (each 0–100). Both
 * the signed and absolute forms are kept so a "+4" delta restatement matches.
 */
function authoritativeScoreValues(signal: MetricSignal): number[] {
  const values: number[] = [];
  const push = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isFinite(n)) {
      values.push(n);
      values.push(Math.round(n));
      values.push(Math.abs(n));
    }
  };
  push(signal.current);
  push(signal.delta);
  for (const c of signal.contributors ?? []) push(c.value);
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
 * Find every number the score prose asserts that does not trace to the score or
 * one of its contributor values. Empty array when the prose is empty or every
 * number is grounded. The caller treats a non-empty result as "fall back to the
 * deterministic text" — never a hard block.
 */
export function findUngroundedScoreNumbers(
  summary: string,
  signal: MetricSignal,
): UngroundedScoreNumber[] {
  if (!summary) return [];
  const authoritative = authoritativeScoreValues(signal);
  const findings: UngroundedScoreNumber[] = [];
  for (const { value, raw } of extractNumbers(summary)) {
    if (isStructural(value, raw)) continue;
    if (isGrounded(value, authoritative)) continue;
    findings.push({ value, source: raw.slice(0, 32) });
  }
  return findings;
}
