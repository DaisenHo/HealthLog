"use client";

import { cn } from "@/lib/utils";

/**
 * v1.12.4 — compact explainer for the mood surface.
 *
 * v1.22 — the round info glyph that hid the statistical caveat behind a
 * hover/focus tooltip is gone. The maintainer wants the trailing "i"
 * affordance removed across the insights surface; the descriptive text it
 * used to gate now reads inline as a muted caption, so the explanation is
 * always visible rather than disclosure-only. The `label` prop is retained
 * for callers but is no longer rendered as an accessible trigger name —
 * there is no trigger to name.
 */
export function MoodExplainerIcon({
  detail,
  className,
}: {
  /** Accessible name for the (now removed) trigger. Retained for callers. */
  label: string;
  /** The explanation, rendered inline as a muted caption. */
  detail: string;
  className?: string;
}) {
  return (
    <span
      data-slot="mood-explainer-detail"
      className={cn("text-muted-foreground text-xs leading-snug", className)}
    >
      {detail}
    </span>
  );
}
