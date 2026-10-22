/**
 * Metres climbed, derived from a workout's GPS track at write time.
 *
 * The workout batch route fills `Workout.elevationM` from a kept track when
 * the source sent no elevation of its own, so the figure lives on the
 * workout row. Readers, the workout insight among them, take the column and
 * never open the track: no AI path reads route geometry (the egress guard
 * freezes the readers).
 */

/**
 * Total metres climbed, summed from a GeoJSON LineString's altitude channel.
 *
 * Only positive deltas count — this is climb, not net elevation change, which
 * is the figure a rider recognises. Returns null when the geometry carries no
 * altitude channel at all (Withings ships static GPX without one), so the
 * caller can fall back to the denormalised column instead of reporting a
 * confident zero.
 */
export function routeClimbM(geometry: unknown): number | null {
  if (!geometry || typeof geometry !== "object") return null;
  const coords = (geometry as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coords)) return null;

  let climb = 0;
  let previous: number | null = null;
  let seen = 0;
  for (const point of coords) {
    if (!Array.isArray(point) || point.length < 3) continue;
    const alt = point[2];
    if (typeof alt !== "number" || !Number.isFinite(alt)) continue;
    seen++;
    if (previous !== null && alt > previous) climb += alt - previous;
    previous = alt;
  }
  return seen >= 2 ? Math.round(climb) : null;
}
