"use client";

import { DashboardLayoutSection } from "@/components/settings/dashboard-layout-section";

/**
 * v1.18.6 — the visible heading + subtitle now come from the shared
 * `<SettingsSectionFrame>`, and the "← back to hub" link rides the frame's
 * `topSlot`. The body is the layout customizer only.
 */
export function DashboardSection() {
  return <DashboardLayoutSection id="dashboard-layout" />;
}
