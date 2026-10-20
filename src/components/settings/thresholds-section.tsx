"use client";

import { GlucoseReferenceCard } from "@/components/settings/glucose-reference-card";
import { ThresholdsEditorSection } from "@/components/settings/thresholds-editor-section";

/**
 * `<ThresholdsSection>` — route-level wrapper for `/settings/thresholds`
 * (the "Targets" / "Zielwerte" page).
 *
 * v1.8.7.1 — Targets and Sources are two separate settings pages again.
 * This page owns only the per-metric target-range editor
 * (`/api/user/thresholds`); the source-priority ladders moved back onto
 * their own `/settings/sources` page (`<SourcesSection>`). The two were
 * merged into one "Targets & Sources" page in v1.4.34 IW-D, but the
 * combined surface ran long and the two editors drive distinct mutation
 * flows, so each concern is self-contained on its own page.
 *
 * Visual structure on this page:
 *   1. Section heading + subtitle — supplied by the shared
 *      `<SettingsSectionFrame>` in the route (v1.18.6 W9).
 *   2. `<ThresholdsEditorSection>` — per-metric range inputs. The editor
 *      card keeps its own affordance row (icon, reset-all button).
 *
 * v1.4.16: file renamed from the historic
 * `thresholds-settings-section.tsx` (`<ThresholdsSettingsSection>`)
 * so the filename + default export match the slug — every other
 * section in `src/components/settings/` follows the
 * `<slug>-section.tsx` `<SlugSection>` convention. The inner editor
 * card was simultaneously moved out of `thresholds-section.tsx`
 * (where it used to live as `<ThresholdsSection>`) into
 * `thresholds-editor-section.tsx` (`<ThresholdsEditorSection>`) so
 * the names stop clashing.
 */
export function ThresholdsSection() {
  // The glucose reference band sits ABOVE the per-metric editor: it picks the
  // DEFAULT band a glucose reading is judged against, and a per-metric
  // override in the editor below then beats it. Same question, one page —
  // splitting the two across surfaces would hide the precedence.
  return (
    <div className="space-y-4">
      <GlucoseReferenceCard />
      <ThresholdsEditorSection id="thresholds" />
    </div>
  );
}
