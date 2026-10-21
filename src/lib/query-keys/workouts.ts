/**
 * Query keys — workout list, recent strip, and detail caches.
 * Part of the centralized factory; aggregated in `./index.ts`.
 */
export const workoutKeys = {
  // v1.4.32 — workout list + detail caches. `workouts()` is the
  // root key invalidated by the batch-ingest mutation; the recent +
  // detail sub-keys ride underneath so the dashboard tile and the
  // detail page share a cache slot with the list page.
  workouts: () => ["workouts"] as const,
  workoutsRecent: () => ["workouts", "recent"] as const,
  /**
   * v1.4.42 — the `useWorkouts` hook used to
   * spread `workoutsRecent()` and append an opts object inline. The
   * factory now owns the full shape so the hook never reaches for a
   * literal-array wrapper.
   */
  workoutsRecentList: (opts: {
    limit?: number;
    offset?: number;
    since?: string;
    sportType?: string;
  }) => ["workouts", "recent", opts] as const,
  workoutDetail: (id: string) => ["workouts", id] as const,
  /**
   * v1.44 — the workout-route opt-in. Its own root, so invalidating the
   * workout caches after a sync never refetches the setting.
   */
  workoutRoutesPref: () => ["workout-routes-pref"] as const,
};
