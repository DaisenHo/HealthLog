"use client";

import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useTranslations } from "@/lib/i18n/context";

/**
 * v1.4.20 — mobile-only rail trays for the Coach drawer.
 *
 * The desktop layout pins the history rail (lg+) and the sources rail
 * (xl+) alongside the message thread. Below those breakpoints the
 * rails are reachable via chevron triggers in the thread's sub-header
 * strip; each trigger opens the matching side-sheet here.
 *
 * v1.4.28 — carved out of `<CoachDrawer>` (~560 LOC).
 * The parent still owns the rail content + the open/closed state for
 * each tray so this component stays a thin presentational shell that
 * can be unit-tested in isolation without standing up the drawer's
 * snapshot fetch + scope-picker hooks.
 *
 * The component takes pre-rendered rail nodes rather than the raw
 * rail components so the caller controls how each rail's
 * `onSelect` / `onScopeChange` callbacks close the tray (some flows
 * dismiss the tray after a selection; the contract for that lives in
 * the parent, not here).
 */
export interface MobileRailTrayProps {
  historyOpen: boolean;
  onHistoryOpenChange: (next: boolean) => void;
  historyRail: ReactNode;
  sourcesOpen: boolean;
  onSourcesOpenChange: (next: boolean) => void;
  sourcesRail: ReactNode;
}

export function MobileRailTray({
  historyOpen,
  onHistoryOpenChange,
  historyRail,
  sourcesOpen,
  onSourcesOpenChange,
  sourcesRail,
}: MobileRailTrayProps) {
  const { t } = useTranslations();
  return (
    <>
      {/* History tray — slides in from the left edge. v1.12.0 — the
          history rail is no longer inline on any viewport (it used to
          mount inline on lg+), so the tray is available at every
          breakpoint and the `lg:hidden` cap is gone. */}
      <Sheet open={historyOpen} onOpenChange={onHistoryOpenChange}>
        <SheetContent
          side="left"
          data-slot="coach-drawer-history-tray"
          className="w-[88vw] max-w-[320px] p-0"
        >
          <SheetHeader className="border-border/70 border-b p-3">
            <SheetTitle className="text-sm">
              {t("insights.coach.historyTitle")}
            </SheetTitle>
          </SheetHeader>
          <div className="h-full min-h-0 overflow-y-auto">{historyRail}</div>
        </SheetContent>
      </Sheet>
      {/* Sources tray — slides in from the right edge. v1.16.1 — the
          rail no longer has an inline xl+ column; the tray is the one
          sources surface on every viewport (hidden by default, opened
          via the toggle in the rail-tray strip). */}
      <Sheet open={sourcesOpen} onOpenChange={onSourcesOpenChange}>
        <SheetContent
          side="right"
          data-slot="coach-drawer-sources-tray"
          className="w-[88vw] max-w-[320px] p-0"
        >
          <SheetHeader className="border-border/70 border-b p-3">
            <SheetTitle className="text-sm">
              {t("insights.coach.sourcesTitle")}
            </SheetTitle>
          </SheetHeader>
          <div className="h-full min-h-0 overflow-y-auto">{sourcesRail}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}
