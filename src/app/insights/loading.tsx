/**
 * v1.8.3 — route-level loading skeleton for every `/insights/*` segment.
 *
 * Defense-in-depth for the navigation-freeze class: any RSC await on an
 * insights route (now or in a future refactor) streams this skeleton
 * instead of blocking the transition. The geometry mirrors `SubPageShell`
 * (heading + chart card + assessment card) so the post-load swap reflows
 * by less than a row. Pure server component — no client hooks, no data
 * fetch; Next.js renders it instantly while the segment streams.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
export default function InsightsLoading() {
  return (
    <div data-slot="insights-subpage-loading" className="space-y-6">
      <header className="space-y-2">
        <Skeleton className="bg-muted h-7 w-48 rounded" />
        <Skeleton className="bg-muted/70 h-4 w-72 rounded" />
      </header>

      {/* Chart card */}
      <Card>
        <CardContent className="space-y-4">
          <Skeleton className="bg-muted h-4 w-32 rounded" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </CardContent>
      </Card>

      {/* Assessment card */}
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="bg-muted h-5 w-5 rounded" />
            <Skeleton className="bg-muted h-4 w-40 rounded" />
          </div>
          <Skeleton className="bg-muted h-3.5 w-full rounded" />
          <Skeleton className="bg-muted h-3.5 w-11/12 rounded" />
          <Skeleton className="bg-muted h-3.5 w-9/12 rounded" />
        </CardContent>
      </Card>
    </div>
  );
}
