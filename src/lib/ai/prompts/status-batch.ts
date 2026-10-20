/**
 * v1.18.7 — the prompt scaffold for the BATCHED per-metric status
 * assessment.
 *
 * Instead of seven independent `runStatusCompletion` calls — one per
 * specialised metric card, each re-analysing measurement rows the
 * comprehensive briefing already covered — the warm passes build the seven
 * per-metric snapshots once and send ONE prompt asking the model for a
 * `{ perMetric: { <key>: "<assessment>" } }` envelope.
 *
 * The grounding / tone / safety contract is IDENTICAL to a standalone status
 * card: the system prompt is the shared `getBaseSystemPrompt` assessment
 * scaffold (which already composes the shared-contracts fragments) plus a
 * thin batch wrapper that (a) names the per-metric output keys and (b)
 * restates that each metric is assessed strictly from ITS OWN snapshot block.
 * The user prompt concatenates each pending card's existing per-metric user
 * prompt under a labelled `### <key>` section, so every metric carries the
 * very snapshot + per-metric suffix it would have sent on its own.
 */
import type { Locale } from "@/lib/i18n/config";
import { getBaseSystemPromptBody } from "./base-system";
import { instructionLocale, withOutputLanguage } from "./output-language";

/**
 * The stable per-metric output keys the batch envelope uses. The InsightStatus
 * scope (`blood-pressure`, …) maps to a short key (`bp`, …) the model echoes
 * back. The map is the single source of truth for both the prompt and the
 * response parser.
 */
export const STATUS_BATCH_KEY_BY_METRIC: Record<string, string> = {
  "blood-pressure": "bp",
  weight: "weight",
  pulse: "pulse",
  bmi: "bmi",
  mood: "mood",
  "medication-compliance": "compliance",
  general: "general",
};

/**
 * Compose the batch system prompt: the shared assessment scaffold plus the
 * `{ perMetric }` output instruction. `presentKeys` are the output keys for
 * the metrics the user actually has data for — absent metrics are NOT listed,
 * so the model is told exactly which keys to produce and never invents one.
 */
export function getStatusBatchSystemPrompt(
  locale: Locale,
  presentKeys: readonly string[],
): string {
  const base = getBaseSystemPromptBody(locale);
  const keyList = presentKeys.join(", ");
  const en = `BATCHED OUTPUT — you are assessing SEVERAL of this user's metrics in one pass. Each metric below carries its OWN graded snapshot under a "### <key>" heading; assess each one STRICTLY from its own snapshot block, applying every rule above per metric. Do NOT let one metric's finding leak into another. Do NOT invent a metric: assess ONLY the keys present below.

OUTPUT FORMAT: Reply with valid JSON only, in exactly this schema. "perMetric" carries one short assessment (2-4 sentences each, the same contract as a single card) per present key:
{ "perMetric": { ${presentKeys.map((k) => `"${k}": "..."`).join(", ")} } }
Include a key ONLY if its snapshot block is present below (keys present: ${keyList}). Omit any metric whose block is absent — never fabricate one.`;
  const de = `GEBÜNDELTE AUSGABE — du bewertest in einem Durchgang MEHRERE Metriken dieses Nutzers. Jede Metrik unten trägt ihren EIGENEN graded snapshot unter einer Überschrift "### <key>"; bewerte jede ausschließlich aus ihrem eigenen Snapshot-Block und wende alle obigen Regeln pro Metrik an. Lass den Befund einer Metrik NICHT in eine andere überlaufen. Erfinde KEINE Metrik: bewerte NUR die unten vorhandenen Keys.

AUSGABEFORMAT: Antworte ausschließlich mit validem JSON in genau diesem Schema. "perMetric" enthält je vorhandenem Key eine kurze Einschätzung (je 2-4 Sätze, derselbe Vertrag wie eine Einzelkarte):
{ "perMetric": { ${presentKeys.map((k) => `"${k}": "..."`).join(", ")} } }
Nimm einen Key NUR auf, wenn sein Snapshot-Block unten vorhanden ist (vorhandene Keys: ${keyList}). Lass jede Metrik ohne Block weg — erfinde niemals eine.`;
  return withOutputLanguage(
    `${base}\n\n${instructionLocale(locale) === "en" ? en : de}`,
    locale,
  );
}

/**
 * Compose the batch user prompt by concatenating each pending card's own
 * per-metric user prompt under a `### <key>` heading. Each section already
 * carries that metric's snapshot JSON + its per-metric instruction suffix, so
 * the batched prompt is grounded exactly like the individual calls were.
 */
export function buildStatusBatchUserPrompt(
  sections: ReadonlyArray<{ key: string; userPrompt: string }>,
): string {
  return sections
    .map((section) => `### ${section.key}\n\n${section.userPrompt}`)
    .join("\n\n---\n\n");
}
