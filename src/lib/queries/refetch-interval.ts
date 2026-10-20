/**
 * Shared client refetch cadence for the live dashboard / analytics
 * surfaces.
 *
 * An open page (dashboard tile strip, Insights charts) polls its data
 * source on this interval so freshly-synced Withings / HealthKit
 * readings appear without a manual reload. The poll is backgrounded
 * while the tab is hidden and never touches the LLM surfaces (those
 * stay daily / pre-generated).
 *
 * The server-side dashboard-snapshot cache TTL is keyed off this value
 * (see `src/app/api/dashboard/snapshot/route.ts`) so a scheduled
 * refetch lands on a warm cache entry rather than a guaranteed miss.
 */
export const DASHBOARD_REFETCH_INTERVAL_MS = 120_000;

/**
 * How many fetches a bounded poll has made: the ones that settled with data
 * and the ones that failed. TanStack Query's `dataUpdateCount` alone does not
 * move on a failed fetch, and the last good payload stays in place, so a
 * poll counted on it kept going for as long as the request kept failing.
 */
export function pollAttemptCount(state: {
  dataUpdateCount: number;
  errorUpdateCount: number;
}): number {
  return state.dataUpdateCount + state.errorUpdateCount;
}

/*
 * ── Every client poll, in one place ─────────────────────────────────────
 *
 * The web client polls in three shapes, and each poll belongs to exactly
 * one of them. The inventory of every poll, with its interval and why, is
 * `src/__tests__/client-poll-inventory-guard.test.ts`: it is held to every
 * `refetchInterval:` in the tree, so a new poll is added there or the suite
 * fails.
 *
 * 1. STANDING — a fixed interval while the surface is mounted. TanStack
 *    Query pauses it while the tab is hidden (`refetchIntervalInBackground`
 *    defaults to false), so it costs nothing on a background tab. The
 *    version poller (`version-poller.tsx`, 60 s) is a plain timer of the
 *    same shape.
 *
 * 2. UNTIL-DONE — polls while a server job is visibly running and stops on
 *    the terminal state the response reports. The interval is short because
 *    a person is watching a progress indicator; the stop condition is what
 *    bounds it, so it must be a state the server always reaches.
 *
 * 3. BOUNDED — polls while the server says fresh model text is on its way
 *    (`preparing` / `revalidating`), with an attempt ceiling, because a
 *    generation that keeps failing would otherwise poll an open page
 *    forever. The ceilings live beside the deciders
 *    (`nextStatusPollInterval`, `nextAdvisorPollInterval`) and count
 *    attempts with {@link pollAttemptCount}, failed fetches included.
 *
 * A document that is never indexed is the reason the two document polls are
 * bounded by the upload window (`RECENT_UPLOAD_WINDOW_MS` in
 * `src/components/documents/vault-utils.ts`) rather than by the index alone:
 * until v1.43.7 the Coach polled such an attachment every 2.5 s for as long
 * as it stayed open.
 *
 * Server-side timers (job heartbeats, the heap monitor, the log flush) are
 * not client polls and are not listed.
 */
