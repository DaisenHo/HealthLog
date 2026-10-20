import type { ReactNode } from "react";

import { InsightsLayoutShell } from "@/components/insights/insights-layout-shell";

/**
 * v1.4.25 — shared layout for the routed `/insights` sub-pages.
 *
 * Hosts the sticky `<InsightsTabStrip>` so the metric pills + (mother-
 * page-only) regenerate affordance stay reachable while a user drills
 * into a sub-page. The actual page body still owns its own data fetches
 * — the layout is a thin presentational frame.
 *
 * v1.4.27 — the Coach drawer mounts above the routed children
 * inside a `<CoachLaunchProvider>` so navigating into a sub-page no
 * longer unmounts the drawer. Every sub-page mounts a
 * `<CoachLaunchButton>` that calls `askCoach()` on the same context;
 * the mother `/insights/page.tsx` consumes the same hook for its hero
 * strip + suggested-prompt chips.
 *
 * v1.4.34 — `<CoachLaunchProvider>` + `<LayoutCoachMount>` now
 * live on the global `<AuthShell>` (`src/components/layout/auth-shell.tsx`)
 * so every authenticated route (dashboard included) can open the drawer
 * from the same context.
 *
 * v1.16.8 — the floating Coach launcher (`LayoutCoachFab`) moved to
 * `<AuthShell>` as well: it renders once for every authenticated route
 * and hides itself on the Coach page, so this layout no longer mounts
 * any Coach surface of its own.
 */
export default function InsightsLayout({ children }: { children: ReactNode }) {
  return <InsightsLayoutShell>{children}</InsightsLayoutShell>;
}
