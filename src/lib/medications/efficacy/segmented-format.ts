/**
 * How a segmented-effect estimate is printed, shared by the efficacy tab, the
 * PDF report and the clinician view so all three show the same figure.
 *
 * The precision follows the uncertainty: one significant digit of the standard
 * error decides the decimals (an SE of 0.6 mmHg prints one decimal, 0.02 kg
 * prints two). More digits than that would claim a precision the data does not
 * have; fewer would hide a real interval. Capped at three decimals.
 */
import type { EfficacyEstimate } from "./segmented-effect";

export function estimateDecimals(e: Pick<EfficacyEstimate, "standardError">) {
  const se = Math.abs(e.standardError);
  if (!Number.isFinite(se) || se === 0) return 1;
  return Math.min(3, Math.max(0, -Math.floor(Math.log10(se))));
}

/**
 * The three numbers of an estimate as display strings, the point estimate
 * signed. `num` is the caller's locale formatter.
 */
export function formatEstimate(
  e: EfficacyEstimate,
  num: (value: number, decimals: number) => string,
): { value: string; low: string; high: string } {
  const decimals = estimateDecimals(e);
  // A value that rounds to zero prints unsigned, never "-0.0".
  const signed = (v: number) => {
    const text = num(v, decimals);
    const rounded = Number(v.toFixed(decimals));
    return rounded > 0 ? `+${text}` : rounded === 0 ? num(0, decimals) : text;
  };
  return {
    value: signed(e.estimate),
    low: num(e.ciLow, decimals),
    high: num(e.ciHigh, decimals),
  };
}
