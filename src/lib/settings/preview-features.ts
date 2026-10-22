/**
 * Per-user opt-in to preview features, persisted in `User.previewFeaturesJson`.
 *
 * One boolean per flag, every flag off by default. A preview feature is
 * something finished enough to try and not yet the default; switching one on
 * adds it beside what is there and never replaces an existing page.
 *
 * Flags:
 * - `topics`: topic overview pages above the single-metric Insights pages.
 *   Stored, served by `/api/settings/preview-features` and carried by the
 *   backup. The Settings > System switch is not listed until the topic pages
 *   ship, because nothing reads the flag yet.
 *
 * Unknown keys in a stored blob are dropped on read, so a flag retired later
 * disappears cleanly and a malformed blob reads as everything off.
 */

export const PREVIEW_FEATURE_KEYS = ["topics"] as const;
export type PreviewFeatureKey = (typeof PREVIEW_FEATURE_KEYS)[number];

export type PreviewFeatures = Record<PreviewFeatureKey, boolean>;

export const DEFAULT_PREVIEW_FEATURES: PreviewFeatures = { topics: false };

export function resolvePreviewFeatures(raw: unknown): PreviewFeatures {
  const out: PreviewFeatures = { ...DEFAULT_PREVIEW_FEATURES };
  if (raw === null || raw === undefined || typeof raw !== "object") return out;
  const blob = raw as Record<string, unknown>;
  for (const key of PREVIEW_FEATURE_KEYS) {
    if (blob[key] === true) out[key] = true;
  }
  return out;
}
