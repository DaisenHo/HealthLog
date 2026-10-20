/**
 * v1.15.11 — pure reorder helper for the inline Insights edit mode.
 *
 * Mirrors the `reorderWidgets` contract in
 * `src/components/settings/dashboard-layout-section.tsx` (move an item from
 * `fromId` next to `toId`, renumber the whole list to a dense 0-based
 * `order`) but is generic over any `{ id, order }` row so the section list
 * AND the Vitals tile sub-list can both reorder through one tested helper.
 *
 * Kept as a standalone module (not imported from the dashboard component) so
 * the inline-edit surface does not depend on a Settings component, and so the
 * helper is unit-testable without spinning up a `DndContext`. The dashboard's
 * own `reorderWidgets` stays untouched — extracting it there would have
 * touched the stable dashboard surface for no behavioural gain.
 */
export interface OrderableRow {
  id: string;
  order: number;
}

/**
 * Move the row identified by `fromId` to the position of `toId`, then
 * renumber every row to a dense 0-based `order`. Returns a NEW array of NEW
 * row objects (every input field is preserved via the spread); the input is
 * never mutated. A no-op move (same id, or either id missing) still returns a
 * densely-renumbered copy so the caller can treat the output as canonical.
 */
export function reorderById<T extends OrderableRow>(
  rows: readonly T[],
  fromId: string,
  toId: string,
): T[] {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  const fromIdx = sorted.findIndex((r) => r.id === fromId);
  const toIdx = sorted.findIndex((r) => r.id === toId);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) {
    return sorted.map((r, i) => ({ ...r, order: i }));
  }
  const next = [...sorted];
  const [removed] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, removed);
  return next.map((r, i) => ({ ...r, order: i }));
}

/**
 * v1.15.11 — rebuild a full tile list after reordering ONLY the Vitals
 * subset, without the non-transitive mixed-key comparator the inline edit mode
 * used to run. Walks the ORIGINAL `order` of every tile: a non-Vitals tile
 * (the routed sub-page strip) keeps its slot verbatim; each Vitals slot, in
 * original-order position, is filled by the next id from `reorderedVitalsIds`.
 * The result is densely renumbered 0-based so the persisted blob stays
 * canonical. Pure + total-order by construction — no `sort` with a key that
 * flips per pair.
 *
 * `tiles` is the full draft list; `isVitals` decides membership; the returned
 * array preserves every non-`order` field on each row.
 */
export function rebuildTilesWithReorderedVitals<T extends OrderableRow>(
  tiles: readonly T[],
  reorderedVitalsIds: readonly string[],
  isVitals: (id: string) => boolean,
): T[] {
  const original = [...tiles].sort((a, b) => a.order - b.order);
  const byId = new Map(tiles.map((t) => [t.id, t]));
  let vIdx = 0;
  return original
    .map((t) => {
      if (!isVitals(t.id)) return t;
      const replacementId = reorderedVitalsIds[vIdx++] ?? t.id;
      return byId.get(replacementId) ?? t;
    })
    .map((t, i) => ({ ...t, order: i }));
}
