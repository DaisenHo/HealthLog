"use client";

/**
 * The rail's rows: the height steps every row shares and one destination
 * row, collapsed or expanded. Split from `sidebar-nav.tsx`, which keeps the
 * shell, the footer and the user menu.
 */
import Link from "next/link";

import type { NavDestination } from "@/components/layout/nav-model";
import { PreviewBadge } from "@/components/topics/preview-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { medicationsPrefetchIntentProps } from "@/lib/queries/prefetch-medications";
import { cn } from "@/lib/utils";

/**
 * Height-based density for the rail. A 13-inch laptop at 100 % zoom leaves
 * the browser roughly 700–860 px, and the full destination list plus the
 * footer rows did not fit: the list scrolled, and on a classic-scrollbar
 * platform (Windows) the rail grew a native scrollbar with arrow buttons.
 * On short windows the rows close their gaps first, then step their height
 * down; tall windows keep the roomy default. Desktop-only by construction —
 * the rail is hidden below `md`, so the phone layout never sees these steps.
 *
 * Steps (rows are full-width, so the click target is the whole row):
 * - default: 40 px rows, 4 px apart
 * - max-height 940 px: gaps close (40 px pitch), list and user padding tighten
 * - max-height 820 px: 36 px rows
 * - max-height 740 px: 32 px rows — the one step under 40 px, taken only
 *   where the alternative is rows hidden behind a scroll edge
 */
// Disjoint height ranges, not nested max-heights: two arbitrary media
// variants on one property cascade in stylesheet order, not by how narrow
// the query is, so a nested pair let the 36 px step win on a 720 px window.
// The height steps apply to a mouse only. Under a finger (a touch tablet)
// the rows keep the 44 px touch floor and the list scrolls behind its fades
// instead. A phone held sideways never sees the rail: it keeps the phone
// shell (`shell-mobile`).
const RAIL_ROW_HEIGHT =
  "min-h-10 pointer-coarse:min-h-11 [@media(hover:hover)_and_(pointer:fine)_and_(740px<height<=820px)]:min-h-9 [@media(hover:hover)_and_(pointer:fine)_and_(height<=740px)]:min-h-8";
export const RAIL_LIST_GAP = "space-y-1 [@media(max-height:940px)]:space-y-0";
export const RAIL_SHORT_PY = "[@media(max-height:940px)]:py-1.5";

/** Rail row, collapsed (icon only) or expanded (icon + label). */
export function railRowClass(collapsed: boolean): string {
  return cn(
    "flex items-center rounded-lg transition-colors",
    RAIL_ROW_HEIGHT,
    collapsed
      ? "justify-center px-2.5"
      : "gap-3 px-3 py-1.5 text-sm font-medium",
  );
}

/** One destination in the rail: an icon row when collapsed, icon and label when expanded. */
export function SidebarNavItem({
  item,
  label,
  badge,
  active,
  collapsed,
  intent,
}: {
  item: NavDestination;
  label: string;
  /** The Beta mark of a preview entry, or null. */
  badge: string | null;
  active: boolean;
  collapsed: boolean;
  /** The medications prefetch handlers, on that one row. */
  intent?: ReturnType<typeof medicationsPrefetchIntentProps>;
}) {
  const className = cn(
    railRowClass(collapsed),
    active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent",
  );
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            aria-current={active ? "page" : undefined}
            data-tour-id={item.tourId}
            {...intent}
            className={className}
          >
            <item.icon className="h-4 w-4" />
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={8}>
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-tour-id={item.tourId}
      {...intent}
      className={className}
    >
      <item.icon className="h-4 w-4" />
      {label}
      {badge ? <PreviewBadge label={badge} className="ml-auto" /> : null}
    </Link>
  );
}
