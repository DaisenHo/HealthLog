/**
 * Oura collections that sit behind a scope beyond `daily` (`spo2`,
 * `heart_health`). A grant issued before HealthLog requested those scopes
 * answers 401 on exactly these, so they are the only names the settings card
 * can be asked to explain. Each has a label under
 * `settings.integrations.oura.scope.items`.
 */
export const OURA_SCOPE_GATED_COLLECTIONS = [
  "spo2",
  "vo2max",
  "cardio_age",
  "resilience",
] as const;

export type OuraScopeGatedCollection =
  (typeof OURA_SCOPE_GATED_COLLECTIONS)[number];

/** Narrow a stored list to the known names, in display order. */
export function ouraScopeReconnectList(
  denied: readonly string[],
): OuraScopeGatedCollection[] {
  return OURA_SCOPE_GATED_COLLECTIONS.filter((c) => denied.includes(c));
}
