/**
 * v1.18.10 — Daily-Briefing number-grounding cross-check.
 *
 * The comprehensive-insight schema validates that `dailyBriefing.paragraph`,
 * `signalsOfDay[]` and `keyFindings[]` are well-shaped (non-empty strings,
 * known enums, length caps) — but it does NOT verify that any NUMBER the model
 * restates in those fields traces back to a figure the server pre-computed.
 * `recommendations[]` carry that guarantee (the citation cross-check + retry +
 * 422 in `generate-insight.ts`); the briefing block did not. A model could
 * write "your weight dropped 3 kg this week" while the snapshot's
 * `features.signalsOfDay` says 2 kg, and the payload still passed.
 *
 * This module closes that gap the same way the recommendations gate does:
 * extract every number the briefing prose asserts, and reject the payload when
 * one of them cannot be matched (within a rounding tolerance) to a figure the
 * server itself pre-computed and handed to the model. The caller turns a
 * non-empty finding list into the existing corrective-retry machinery.
 *
 * The authoritative set is derived by WALKING the prompt payload — the whole
 * aggregated-features object plus any extra section the prompt carries — not
 * by re-listing its blocks by hand. That is the same guarantee stated exactly:
 * a number is grounded iff the server gave it to the model. See
 * `authoritativeValues` for why the previous hand-maintained list had to go.
 *
 * Scope + posture:
 *  - The check only fires when `features.signalsOfDay` is present. When the
 *    server pre-computed no signals there is no authoritative number set to
 *    grade against, so the prose is left to the prompt-level grounding rule
 *    (same as before) — we never reject for a number we have nothing to
 *    compare to.
 *  - It grades NUMBERS only. Tone, framing and word choice stay the prompt's
 *    job; this is purely "did the model restate a figure we did not give it".
 *  - Pure + side-effect-free, so it unit-tests in isolation.
 */
import type { AggregatedFeatures, SignalOfDay } from "@/lib/insights/features";

/**
 * Absolute rounding tolerance when matching a restated number to a
 * pre-computed signal figure. The model legitimately rounds ("+1.24 kg" →
 * "+1.2 kg"); anything inside this band is treated as the same number. A
 * relative slack widens it for large values (heart rate, steps) where a
 * one-decimal restatement of a server mean drifts by more than 0.15 in
 * absolute terms.
 */
const ABS_TOLERANCE = 0.15;
const REL_TOLERANCE = 0.02;

/** The briefing sub-payload we grade. Mirrors `dailyBriefingSchema` loosely. */
export interface BriefingForGrounding {
  paragraph?: unknown;
  signalsOfDay?: Array<{
    headline?: unknown;
    nudge?: unknown;
    delta?: unknown;
  }> | null;
  keyFindings?: Array<{
    headline?: unknown;
    detail?: unknown;
    delta?: unknown;
  }> | null;
}

/** One ungrounded number the briefing asserted. */
export interface UngroundedBriefingNumber {
  /** Which field carried it. */
  field: "paragraph" | "signalsOfDay" | "keyFindings";
  /** The numeric value the model wrote, as parsed. */
  value: number;
  /** The raw token the value was read from (truncated). */
  source: string;
}

/**
 * Parse every standalone number out of a free-text string. Captures an
 * optional leading sign and both `.`/`,` decimal separators (the DE briefing
 * writes "1,2 kg"). Percent / unit suffixes are ignored — only the magnitude
 * matters for grounding. Years and obvious dates (YYYY-MM-DD, "6 May") are not
 * special-cased: a 4-digit run is allowed through and simply won't match any
 * signal figure, which is fine because real briefings do not quote bare years
 * as health numbers, and the tolerance band keeps small ordinals from
 * colliding with real values.
 */
export function extractNumbers(
  text: string,
): Array<{ value: number; raw: string }> {
  const out: Array<{ value: number; raw: string }> = [];
  // Sign, integer part, optional decimal (.,) — bounded so we don't span words.
  const re = /[+-]?\d+(?:[.,]\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const raw = match[0];
    const normalised = raw.replace(",", ".");
    const value = Number.parseFloat(normalised);
    if (Number.isFinite(value)) out.push({ value, raw });
  }
  return out;
}

/**
 * Depth ceiling for the payload walk. The aggregated-features object is a
 * shallow JSON tree (block → field, occasionally block → array → row), so this
 * is pure defence: a malformed or unexpectedly deep shape cannot spin the walk.
 */
const WALK_MAX_DEPTH = 8;

/**
 * Push every finite number reachable inside a JSON-shaped value. Strings are
 * NOT mined for embedded digits — only real numeric fields count as figures the
 * server computed, so a user-supplied label ("Vitamin D3 1000") can never widen
 * the allow-set.
 */
function walkNumbers(
  value: unknown,
  push: (n: number) => void,
  depth = 0,
): void {
  if (depth > WALK_MAX_DEPTH) return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) walkNumbers(entry, push, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) {
      walkNumbers(entry, push, depth + 1);
    }
  }
}

/**
 * The set of authoritative magnitudes one signal exposes. We grade against
 * absolute magnitudes so a "+1.2" delta matches a `deltaVs7` of `-1.2` only
 * when the model also flipped the sign in prose — but because briefings phrase
 * direction in words ("dropped", "up"), grading on |value| avoids penalising
 * the model for choosing a sign convention. We keep both the signed and the
 * absolute form so an exact signed restatement also matches.
 */
function authoritativeValues(
  signals: readonly SignalOfDay[],
  features?: AggregatedFeatures | null,
  extra?: unknown,
): number[] {
  const values: number[] = [];
  const push = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isFinite(n)) {
      values.push(n);
      values.push(Math.abs(n));
    }
  };
  for (const s of signals) {
    push(s.latest);
    push(s.avg7);
    push(s.avg30);
    push(s.deltaVs7);
    push(s.deltaVs30);
    push(s.spread30);
    if (s.recentAnomaly) push(s.recentAnomaly.value);
  }

  // The allow-set is now derived by WALKING the payload rather than by
  // re-listing its blocks by hand. `buildUserPrompt` serialises the WHOLE
  // aggregated-features object into the prompt, so "a number the server gave
  // the model" is precisely "a number that appears somewhere in that object" —
  // and every value in it is server-computed, so the anti-fabrication
  // guarantee is unchanged: a figure the model invented still matches nothing.
  //
  // The hand-maintained list this replaces drifted from the prompt three times
  // (v1.22 wired in the glucose / labs / preventive / workout blocks, v1.25.1
  // the clinical-depth blocks, v1.25.13 the core vitals), and each drift
  // presented as the whole briefing vanishing for users whose prose happened
  // to cite the newest block. The blocks the list still omitted — medication
  // compliance rates and streaks, the `context` counters, the correlation
  // coefficients, and every block's `coverage` object — are all fed to the
  // model and were all ungradeable, so a briefing that cited an adherence rate
  // was discarded for quoting a figure the server itself computed. Walking the
  // object removes that whole failure class instead of adding a fourth block.
  walkNumbers(features, push);
  // The comparison snapshot is handed to the model as its own prompt section
  // (`buildComparisonBlock`) with explicit current / baseline / delta figures,
  // and the system prompt asks the model to narrate them — so its numbers are
  // authoritative on exactly the same footing.
  walkNumbers(extra, push);

  return values;
}

/** True when `value` matches any authoritative figure within tolerance. */
function isGrounded(value: number, authoritative: readonly number[]): boolean {
  for (const a of authoritative) {
    const tol = Math.max(ABS_TOLERANCE, Math.abs(a) * REL_TOLERANCE);
    if (Math.abs(value - a) <= tol) return true;
  }
  return false;
}

/**
 * Numbers a briefing may always state without a signal match: small integers
 * the prose uses structurally (a day count, "3 signals", "last 7 days"), which
 * would otherwise false-positive against honest window/ordinal phrasing. We
 * exempt only bare integers (no decimal) that are either a small ordinal (≤ 3)
 * or one of the literal window lengths the briefing references (7/14/30/90/365).
 *
 * Trade-off: a fabricated number that happens to be exactly one of those bare
 * window integers slips through. That is the deliberate conservative choice —
 * the typical fabrication shapes (a restated delta/mean) carry a decimal or a
 * non-window magnitude (a 6.4 kg drop, a pulse of 72, "down 5 kg") and are
 * still graded; exempting the window vocabulary avoids reflexively flagging
 * every honest "over the last 7 days". A real restated health figure that is a
 * round window integer is rare and the grounding rule in the prompt remains the
 * backstop for it.
 */
const STRUCTURAL_INTEGERS = new Set([7, 14, 30, 31, 90, 365]);

function isStructural(value: number, raw: string): boolean {
  if (raw.includes(".") || raw.includes(",")) return false;
  if (!Number.isInteger(value)) return false;
  const abs = Math.abs(value);
  if (abs <= 3) return true; // "3 signals", "2 days", ordinals
  return STRUCTURAL_INTEGERS.has(abs);
}

/**
 * Find every number the briefing block asserts that does not trace to a
 * pre-computed `features.signalsOfDay` figure. Returns an empty array when the
 * briefing is absent, when no signals were pre-computed (nothing to grade
 * against), or when every restated number is grounded.
 */
export function findUngroundedBriefingNumbers(
  briefing: BriefingForGrounding | null | undefined,
  signals: readonly SignalOfDay[] | null | undefined,
  features?: AggregatedFeatures | null,
  /**
   * Any further server-computed payload the prompt hands the model alongside
   * the features — today the comparison snapshot. Walked for numbers exactly
   * like `features`; pass nothing when the prompt carried no extra section.
   */
  extraPromptPayload?: unknown,
): UngroundedBriefingNumber[] {
  if (!briefing) return [];
  if (!signals || signals.length === 0) return [];

  const authoritative = authoritativeValues(
    signals,
    features,
    extraPromptPayload,
  );
  // No usable authoritative figures (every field null) — nothing to grade.
  if (authoritative.length === 0) return [];

  const findings: UngroundedBriefingNumber[] = [];

  const grade = (
    field: UngroundedBriefingNumber["field"],
    text: unknown,
  ): void => {
    if (typeof text !== "string" || text.length === 0) return;
    for (const { value, raw } of extractNumbers(text)) {
      if (isStructural(value, raw)) continue;
      if (isGrounded(value, authoritative)) continue;
      findings.push({ field, value, source: raw.slice(0, 32) });
    }
  };

  grade("paragraph", briefing.paragraph);
  for (const s of briefing.signalsOfDay ?? []) {
    grade("signalsOfDay", s?.headline);
    grade("signalsOfDay", s?.nudge);
    grade("signalsOfDay", s?.delta);
  }
  for (const f of briefing.keyFindings ?? []) {
    grade("keyFindings", f?.headline);
    grade("keyFindings", f?.detail);
    grade("keyFindings", f?.delta);
  }

  return findings;
}

/**
 * Read the `dailyBriefing` block off a parsed comprehensive payload, whatever
 * its concrete type (the strict `InsightResult` or the loose passthrough
 * object). Returns null when no briefing is present.
 */
export function readBriefingBlock(
  parsed: unknown,
): BriefingForGrounding | null {
  if (!parsed || typeof parsed !== "object") return null;
  const briefing = (parsed as { dailyBriefing?: unknown }).dailyBriefing;
  if (!briefing || typeof briefing !== "object") return null;
  return briefing as BriefingForGrounding;
}

/**
 * Build the corrective user-prompt suffix appended on a grounding miss, naming
 * the offending numbers so the model can self-correct on the single retry —
 * the same cite-or-omit posture the recommendations gate uses.
 */
export function buildBriefingGroundingCorrection(
  findings: readonly UngroundedBriefingNumber[],
): string {
  const list = findings
    .slice(0, 6)
    .map((f) => `${f.source} (in ${f.field})`)
    .join(", ");
  return `
Your daily-briefing block stated numbers that do NOT appear in the snapshot's pre-computed "signalsOfDay" figures: ${list}.

Re-write the dailyBriefing (paragraph, signalsOfDay, keyFindings) so EVERY number you state matches a value the snapshot already gives you — the latest reading, the 7-day or 30-day average, or the signed delta against one of those. Do NOT invent or re-derive a figure. If you cannot ground a number, drop the number and keep only the qualitative framing. Return the full JSON object again.
`;
}
