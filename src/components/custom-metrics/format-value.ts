/**
 * Format a custom-metric value for display.
 *
 * When the metric defines a fixed number of decimals, honour it; otherwise fall
 * back to a compact representation that trims trailing zeros (up to 3 places).
 * The digits come from the caller's locale formatter (`useFormatters().number`),
 * so a German reader sees "70,5" where an English one sees "70.5".
 */
export function formatMetricValue(
  value: number,
  decimals: number | null | undefined,
  formatNumber: (value: number, fractionDigits?: number) => string,
): string {
  if (!Number.isFinite(value)) return "—";
  if (decimals != null) {
    return formatNumber(value, decimals);
  }
  // Compact default: round to at most 3 places and drop trailing zeros.
  return formatNumber(Math.round(value * 1000) / 1000);
}
