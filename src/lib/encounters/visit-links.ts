/**
 * Where a visit lives in the app, spelled once.
 *
 * Visits have no page of their own: they are the second tab of `/checkups`,
 * beside the preventive-care list that opens by default. A bare `/checkups`
 * therefore lands on the checkups, which is the wrong half of the page for an
 * appointment, and every surface that hand-spelled that path for a visit (the
 * dashboard's next-appointment line, the Today rail, the Today overview, the
 * appointment's push) sent the person to the list the appointment is not on.
 *
 * Every link to one visit or to the visits list is built here. The checkups
 * page reads both parameters: `visit` opens that visit on the visits tab
 * (`src/hooks/use-deep-linked-record.ts`), `view` picks a tab.
 * `visit-link-guard.test.ts` refuses a hand-spelled copy elsewhere.
 *
 * Pure and client-safe: no server imports.
 */

/** The tabs of the checkups page, as the `view` parameter names them. */
export const CHECKUPS_VIEWS = [
  "vorsorge",
  "visits",
  "procedures",
  "body-sites",
] as const;

export type CheckupsView = (typeof CHECKUPS_VIEWS)[number];

/** The tab a `view` parameter names, or null for anything else. */
export function parseCheckupsView(
  value: string | null | undefined,
): CheckupsView | null {
  return (CHECKUPS_VIEWS as readonly string[]).includes(value ?? "")
    ? (value as CheckupsView)
    : null;
}

/** The visits list: the checkups page opened on its visits tab. */
export const VISITS_PATH = "/checkups?view=visits";

/** One visit: the visits tab, scrolled to the visit and opened. */
export function visitPath(id: string): string {
  return `/checkups?visit=${encodeURIComponent(id)}`;
}

/**
 * Where a group of visits leads: the visit itself when there is one, the
 * visits list when several share one line (a day with two appointments).
 */
export function visitsPath(ids: readonly string[]): string {
  return ids.length === 1 ? visitPath(ids[0]) : VISITS_PATH;
}
