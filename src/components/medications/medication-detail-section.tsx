"use client";

import { type ReactNode } from "react";

/**
 * v1.4.25 — section wrapper for the medication-detail panels
 * (Titration, Scheduling, SideEffects, DrugLevelChart). The earlier
 * sections hand-rolled the same chrome — border + header row + dotted
 * divider + body padding — and drifted on padding, border opacity, and
 * aria wiring.
 *
 * v1.15.20 — lifted to the card language the rest of the detail page
 * speaks (`SettingsGroup`, the dashboard cards): `bg-card` surface,
 * `rounded-xl`, `p-4 md:p-6` padding. The body band reads at `text-sm`
 * (the standard body scale) instead of the former `text-xs` container,
 * so every tab renders the same surface vocabulary.
 *
 * Contract:
 *   - `bg-card rounded-xl border p-4 md:p-6` chrome
 *   - header row with
 *     `text-foreground text-base font-semibold leading-6 tracking-tight`
 *     title, separated from the body by a `border-border/60` rule
 *   - `pt-3 text-sm` body band
 *   - `aria-labelledby` wired to a stable per-section id derived from `titleId`
 *
 * Consumers pass:
 *   - `titleId` — the DOM id on the heading element. Components owning
 *     a heading id already (e.g. "titration-heading") pass it through;
 *     new surfaces should follow the `<slot>-heading` convention.
 *   - `title` — the rendered heading text (already i18n-translated by
 *     the caller).
 *   - `headerExtras` — optional right-side header content (e.g. drug
 *     INN badge, edit CTA, "Add" button).
 *   - `dataSlot` — optional `data-slot` attribute on the outer section
 *     so cross-section selectors (Playwright, snapshot tests) stay
 *     stable.
 */
export interface MedicationDetailSectionProps {
  titleId: string;
  title: ReactNode;
  headerExtras?: ReactNode;
  children: ReactNode;
  dataSlot?: string;
}

export function MedicationDetailSection({
  titleId,
  title,
  headerExtras,
  children,
  dataSlot,
}: MedicationDetailSectionProps) {
  return (
    <section
      className="bg-card rounded-xl border p-4 md:p-6"
      aria-labelledby={titleId}
      {...(dataSlot ? { "data-slot": dataSlot } : {})}
    >
      <header className="border-border/60 flex items-center justify-between gap-2 border-b pb-3">
        <h2
          id={titleId}
          className="text-foreground text-base leading-6 font-semibold tracking-tight"
        >
          {title}
        </h2>
        {headerExtras}
      </header>
      <div className="pt-3 text-sm">{children}</div>
    </section>
  );
}
