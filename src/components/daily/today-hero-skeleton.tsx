import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading silhouette for the Today hero.
 *
 * Mirrors the real `<TodayHero>` footprint — the same plain `bg-card`
 * shell (border + radius + `p-4 md:p-6`), the two-column read/ring split
 * with the fixed md (168 px) score circle on the trailing edge, and a
 * two-card rail row — so the swap to the loaded hero happens in place
 * with zero layout shift.
 *
 * The shimmer rides the `<Skeleton>` primitive (`skeleton-shimmer`), which
 * is reduced-motion safe via its own CSS guard in `globals.css`. The shell
 * carries the same `.today-hero-wash` atmosphere as the loaded hero so the
 * swap changes content, never the surface. Always `aria-hidden`: the
 * tile-strip skeleton alongside carries the page's loading semantics, so a
 * second announcement here would double up for screen readers.
 */
export function TodayHeroSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-slot="today-hero-skeleton"
      className="bg-card today-hero-wash border-border relative isolate overflow-hidden rounded-xl border p-4 md:p-6"
    >
      <div className="flex flex-col gap-3 md:gap-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div className="min-w-0 flex-1 space-y-2">
            {/* Lead read (two lines) + top signal + briefing link. */}
            <Skeleton className="h-6 w-3/4 max-w-full" />
            <Skeleton className="h-4 w-56 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
          {/* Score ring — the always-present md (168 px) health circle. */}
          <div className="flex shrink-0 items-center justify-center md:justify-end">
            <Skeleton className="size-[168px] rounded-full" />
          </div>
        </div>
        {/* Worth-a-look rail — heading bar + two placeholder cards, matching
            the loaded rail's uppercase heading row and `xl:grid-cols-3` step. */}
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
