/**
 * "just now" / "12 min ago" / "3 h ago" / "2 days ago" for a sync or arrival
 * age in milliseconds. Used by the Apple Health card and the per-metric
 * freshness list; it outlived the status pill it was written for.
 */
export function formatRelative(
  deltaMs: number,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (deltaMs < 60_000) return t("settings.integrationPill.justNow");
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) {
    return t("settings.integrationPill.minutesAgo", { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return t("settings.integrationPill.hoursAgo", { count: hours });
  }
  const days = Math.floor(hours / 24);
  return t("settings.integrationPill.daysAgo", { count: days });
}
