/**
 * v1.4.25 — injection-site rotation logic.
 *
 * The 8-zone enum maps to the Prisma `InjectionSite` enum exactly so
 * the snapshot, the picker, the card variant, and the doctor-report
 * all speak the same vocabulary. Front-of-body view, mirrored for
 * left/right per Eli Lilly's Mounjaro PI + Novo Nordisk's
 * Ozempic/Wegovy PI rotation guidance.
 */

export const INJECTION_SITE_KEYS = [
  "ABDOMEN_LEFT",
  "ABDOMEN_RIGHT",
  "ABDOMEN_UPPER_LEFT",
  "ABDOMEN_UPPER_RIGHT",
  "THIGH_LEFT",
  "THIGH_RIGHT",
  "UPPER_ARM_LEFT",
  "UPPER_ARM_RIGHT",
] as const;

export type InjectionSiteKey = (typeof INJECTION_SITE_KEYS)[number];

/**
 * SVG position for each site on the anatomical front-of-body figure
 * (`100 x 200` viewBox, aspect ≈0.5). Used by `injection-site-picker.tsx`
 * to render the clickable dots AND by {@link nextInjectionSite} as the
 * Euclidean-distance basis for the rotation recommendation, so the two
 * always agree on where a site "is".
 *
 * Calibrated against the body figure the picker masks onto the viewBox
 * (`/injection-body-front.png`, rendered height-fit + horizontally
 * centred on the 100×200 box): the anchors are measured to land on the
 * figure's anatomy — the abdomen quadrants on the torso either side of
 * the midline, the thigh anchors on the centre of each thigh, and the
 * arm anchors on the upper-arm mass clear of the torso edge. Screen-left
 * (`*_LEFT`) sits at the viewer's left, matching the long-standing
 * "links == screen-left" convention. The iOS client carries its own
 * coordinate set; these are the web picker's only consumer.
 */
export const SITE_COORDS: Record<InjectionSiteKey, { x: number; y: number }> = {
  ABDOMEN_UPPER_LEFT: { x: 43.5, y: 81 },
  ABDOMEN_UPPER_RIGHT: { x: 56.5, y: 81 },
  ABDOMEN_LEFT: { x: 43.5, y: 95 },
  ABDOMEN_RIGHT: { x: 56.5, y: 95 },
  THIGH_LEFT: { x: 40, y: 110 },
  THIGH_RIGHT: { x: 60, y: 110 },
  UPPER_ARM_LEFT: { x: 22, y: 67 },
  UPPER_ARM_RIGHT: { x: 78, y: 67 },
};

/**
 * v1.9.0 — resolve the injection site whose `SITE_COORDS` centre is
 * nearest to a point `(x, y)` expressed in the picker's `100 x 200`
 * viewBox space. This is the deterministic "nearest-centre wins" rule
 * the picker overlay relies on: a single transparent overlay catches
 * the pointer, projects the tap into viewBox space, and resolves it to
 * the closest site — so two visually-stacked dots (the abdomen
 * quadrants sit only Δy=14u apart) can never mis-route to the wrong
 * quadrant the way overlapping per-dot hit-circles did.
 *
 * `allowed` constrains the candidate pool exactly like
 * {@link nextInjectionSite}: `undefined` considers all eight sites; a
 * non-empty array restricts to those sites; an explicitly-empty array
 * yields `null` (nothing selectable). Ties (equidistant centres) break
 * toward the earlier site in canonical `INJECTION_SITE_KEYS` order.
 */
export function nearestSiteAt(
  x: number,
  y: number,
  allowed?: ReadonlyArray<InjectionSiteKey>,
): InjectionSiteKey | null {
  const allowedSet = allowed ? new Set(allowed) : null;
  let best: InjectionSiteKey | null = null;
  let bestDistSq = Infinity;
  for (const site of INJECTION_SITE_KEYS) {
    if (allowedSet !== null && !allowedSet.has(site)) continue;
    const coord = SITE_COORDS[site];
    const dx = coord.x - x;
    const dy = coord.y - y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = site;
    }
  }
  return best;
}

/**
 * v1.8.5 — resolve the effective allowed set for a medication given the
 * per-medication preference and the user-level global exclusion. The
 * global exclusion is a deny-list and ALWAYS wins: a site the user has
 * globally excluded is never offered, even if a per-medication entry
 * lists it as preferred. An empty per-medication list means "no
 * restriction" — every site is allowed (minus the global exclusion).
 *
 * Returns the sites in canonical `INJECTION_SITE_KEYS` order so callers
 * render a stable picker. The result can be empty only when the global
 * exclusion covers every remaining site — callers treat an empty set as
 * "no recommendation, picker shows nothing selectable".
 */
export function effectiveAllowedSites(
  allowed: ReadonlyArray<InjectionSiteKey>,
  globalExcluded: ReadonlyArray<InjectionSiteKey>,
): InjectionSiteKey[] {
  const excludedSet = new Set(globalExcluded);
  // Empty per-med list = no per-med restriction → start from all sites.
  const base: ReadonlyArray<InjectionSiteKey> =
    allowed.length === 0 ? INJECTION_SITE_KEYS : allowed;
  const allowedSet = new Set(base);
  // Canonical order, per-med restriction applied, global exclusion wins.
  return INJECTION_SITE_KEYS.filter(
    (site) => allowedSet.has(site) && !excludedSet.has(site),
  );
}

/**
 * v1.8.5 — server-side guard: is `site` a member of the effective
 * allowed set for this medication? Used by the intake write path to
 * reject (422) a site the user can no longer pick.
 */
export function isSiteAllowed(
  site: InjectionSiteKey,
  allowed: ReadonlyArray<InjectionSiteKey>,
  globalExcluded: ReadonlyArray<InjectionSiteKey>,
): boolean {
  return effectiveAllowedSites(allowed, globalExcluded).includes(site);
}

/**
 * Recommend the next injection site given the recent rotation
 * history. Strategy: maximise the average Euclidean distance from the
 * candidate to each of the last N sites (N defaults to 4), tie-break
 * by least-recently-used (an unseen site beats a stale one).
 *
 * v1.8.5 — an optional `allowed` set constrains the candidate pool to
 * the effective allowed sites (per-med list minus the global
 * exclusion). Pass the result of {@link effectiveAllowedSites}.
 *   - `undefined` (no argument) → legacy "all eight sites" behaviour.
 *   - a non-empty array → the recommender never suggests a site outside it.
 *   - an explicitly-EMPTY array → no candidate (every site excluded);
 *     the function returns `null`.
 *
 * Returns `null` when there is no candidate to recommend — an empty
 * effective set, or when the only allowed site is the most-recent pick.
 */
export function nextInjectionSite(
  history: ReadonlyArray<InjectionSiteKey>,
  windowSize = 4,
  allowed?: ReadonlyArray<InjectionSiteKey>,
): InjectionSiteKey | null {
  // v1.8.5 — restrict the candidate pool when an allowed set is given.
  // `undefined` keeps the legacy all-sites behaviour; an explicitly
  // empty array means "nothing allowed" and yields no recommendation.
  const candidates: ReadonlyArray<InjectionSiteKey> =
    allowed === undefined
      ? INJECTION_SITE_KEYS
      : INJECTION_SITE_KEYS.filter((s) => allowed.includes(s));
  if (candidates.length === 0) return null;

  if (history.length === 0) {
    // First-time user — recommend a sensible default. Within an allowed
    // set the first candidate in canonical order stands in for the
    // legacy "abdomen left" pick.
    return candidates.includes("ABDOMEN_LEFT") ? "ABDOMEN_LEFT" : candidates[0];
  }

  const recent = history.slice(0, windowSize);
  // Site → most recent index in the recent window (lower = more
  // recent). Sites missing from the window get a large rank so they
  // beat any recently-used site in the tie-break.
  const lastSeenRank = new Map<InjectionSiteKey, number>();
  for (let i = 0; i < recent.length; i += 1) {
    if (!lastSeenRank.has(recent[i])) {
      lastSeenRank.set(recent[i], i);
    }
  }

  let bestSite: InjectionSiteKey | null = null;
  let bestScore = -Infinity;

  for (const candidate of candidates) {
    if (candidate === recent[0]) continue; // never recommend the most-recent site
    const candidateCoord = SITE_COORDS[candidate];
    let dist = 0;
    for (const used of recent) {
      const usedCoord = SITE_COORDS[used];
      const dx = candidateCoord.x - usedCoord.x;
      const dy = candidateCoord.y - usedCoord.y;
      dist += Math.sqrt(dx * dx + dy * dy);
    }
    // Recency penalty — sites used more recently score lower.
    const rank = lastSeenRank.get(candidate);
    const recencyBonus = rank === undefined ? recent.length * 50 : -rank * 10;
    const score = dist + recencyBonus;
    if (score > bestScore) {
      bestScore = score;
      bestSite = candidate;
    }
  }

  // Only candidate was the most-recent site — nothing else to rotate to.
  return bestSite;
}

/**
 * i18n-friendly human-readable label key for a site. Caller passes
 * it to `t()` to render the localised string.
 */
export function describeInjectionSite(site: InjectionSiteKey): string {
  const suffix = site
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
  return `medications.site${suffix}`;
}
