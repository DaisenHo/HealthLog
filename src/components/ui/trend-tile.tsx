import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * The frame of a metric trend tile: the dashboard KPI strip (`TrendCard`),
 * the derived-insight tiles (`SparklineDeltaTile`), their skeletons and the
 * "still building" states of the vitals board.
 *
 * Seven copies spelled this frame out by hand, and they had started to
 * differ (some clipped their content, some did not). The frame is a dense
 * tile of its own rather than a `Card`: it sits in a grid of equal-height
 * tiles (`h-full`), insets on the card padding (`p-4 md:p-6`, UI standards
 * §1), carries no shadow, and clips a value that would otherwise push the
 * grid cell wider (`min-w-0 overflow-hidden`).
 *
 * The vertical rhythm inside belongs to the tile: pass `gap-3` for a stacked
 * state, or let the children set their own `mt-*` steps as the loaded tiles do.
 */
function TrendTile({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="trend-tile"
      className={cn(
        "bg-card border-border flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border p-4 md:p-6",
        className,
      )}
      {...props}
    />
  );
}

export { TrendTile };
