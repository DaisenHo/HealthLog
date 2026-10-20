/**
 * v1.22 — gate for the user-visible n-of-1 experiment read-back.
 *
 * The substrate (the `outcomeEncrypted` column, the review worker that writes
 * the grounded read-back, the snapshot read block) all ship in v1.22, but the
 * user-visible verdict stays OFF by default: the read-back is the most
 * overclaim-prone Coach surface in the catalogue, and the live B0 judge that
 * grades a REAL generation on the over-validation axis runs only when
 * `COACH_EVAL_API_KEY` is set (not per-PR). Until those live cases are green an
 * operator must opt in explicitly.
 *
 * Plain env flag (no DB round-trip, no `features.ts` / `ai-budgets.ts` touch):
 * set `COACH_EXPERIMENT_VERDICT=1` to surface reviewed experiment outcomes in
 * the Coach snapshot/prompt. Anything else (unset / "0" / "false") keeps the
 * read-back dormant while the worker keeps writing outcomes behind the scenes.
 */
export function experimentVerdictEnabled(): boolean {
  return process.env.COACH_EXPERIMENT_VERDICT === "1";
}
