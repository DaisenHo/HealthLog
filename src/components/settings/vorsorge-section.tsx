"use client";

/**
 * v1.18.7 — Settings → Vorsorge.
 *
 * The preventive-care reminders customise surface (list view, order,
 * individual reminders) was a standalone `ModuleSettingsFrame` page at
 * `/settings/vorsorge`; it now renders as a first-class Settings section.
 * The shell supplies the page chrome (left nav, heading, subtitle) so this
 * body is the preventive-care cards only. Preventive-care reminders are not
 * a toggleable module, so this entry carries no `moduleGate` (always shown).
 */

import { VorsorgeSettings } from "@/components/measurement-reminders/vorsorge-settings";
import { ScreeningHintsCard } from "@/components/records/screening-hints-card";

export function VorsorgeSection() {
  return (
    <div className="space-y-6">
      <VorsorgeSettings />
      {/* v1.43 (#614) — hints from the life circumstances, with their source. */}
      <ScreeningHintsCard />
    </div>
  );
}
