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

/*
 * ── Every client poll, in one place ─────────────────────────────────────
 *
 * The web client polls in three shapes, and each poll belongs to exactly
 * one of them. A new poll picks its shape here, and is added to this list.
 *
 * 1. STANDING — a fixed interval while the surface is mounted. TanStack
 *    Query pauses it while the tab is hidden (`refetchIntervalInBackground`
 *    defaults to false), so it costs nothing on a background tab.
 *
 *    | Surface                              | Interval | Why this figure                                   |
 *    | ------------------------------------ | -------- | ------------------------------------------------- |
 *    | dashboard snapshot, analytics, digest | 120 s    | this constant; matches the snapshot cache TTL     |
 *    | version poller (`version-poller.tsx`) | 60 s     | a deploy notice within a minute; plain timer      |
 *    | notification channel status           | 30 s     | last-delivery results move while the panel is open |
 *    | admin app-log preview                 | 30 s     | an operator watching a live log                   |
 *    | achievement unlock notifier           | 5 min    | out-of-band unlocks; an app-global poll           |
 *    | admin host metrics chart              | 5 min    | the sampler's own cadence                         |
 *
 * 2. UNTIL-DONE — polls while a server job is visibly running and stops on
 *    the terminal state the response reports. The interval is short because
 *    a person is watching a progress indicator; the stop condition is what
 *    bounds it, so it must be a state the server always reaches.
 *
 *    | Surface                               | Interval | Stops when                                   |
 *    | ------------------------------------- | -------- | -------------------------------------------- |
 *    | Apple Health / Health Connect import  | 2 s      | the job reports a terminal status            |
 *    | admin backup restore list             | 2 s      | no restore is active                         |
 *    | documents list                        | 4 s      | no document is inside its 3-minute upload    |
 *    |                                       |          | processing window without an index           |
 *    | Coach staged attachment               | 2.5 s    | the same: index exists or window passed      |
 *    | admin pulse day-mean / maintenance    | 10 s     | the recompute reports done                   |
 *
 * 3. BOUNDED — polls while the server says fresh model text is on its way
 *    (`preparing` / `revalidating`), with an attempt ceiling, because a
 *    generation that keeps failing would otherwise poll an open page
 *    forever. The ceilings live beside the deciders and are unit-tested.
 *
 *    | Surface                       | Interval | Ceiling                                    |
 *    | ----------------------------- | -------- | ------------------------------------------ |
 *    | status cards (`use-insight-status.ts`, `nextStatusPollInterval`) | 4 s  | 12 attempts |
 *    | advisor / briefing (`nextAdvisorPollInterval`)                   | 25 s | 10 attempts |
 *    | period narrative              | 5 s      | stops once the narrative arrives          |
 *
 *    The period narrative has no attempt ceiling: it stops on a state the
 *    server reaches (the warm writes text or clears `revalidating`), and it
 *    is only mounted while a person is looking at it.
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
