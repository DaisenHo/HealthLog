/**
 * Where a visit lives in the app, spelled once.
 *
 * Visits have no page of their own: they are the second tab of `/checkups`,
 * beside the preventive-care list that opens by default. The checkups page
 * opens the visit a `visit` parameter names on the visits tab
 * (`src/hooks/use-deep-linked-record.ts`).
 *
 * Every link to one visit is built here.
 *
 * Pure and client-safe: no server imports.
 */

/** One visit: the visits tab, scrolled to the visit and opened. */
export function visitPath(id: string): string {
  return `/checkups?visit=${encodeURIComponent(id)}`;
}
