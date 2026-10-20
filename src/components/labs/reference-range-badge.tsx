"use client";

import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { ScorePill } from "@/components/ui/score-pill";
import { useTranslations } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import type { ReferenceRangeStatus } from "@/lib/validations/labs";

/**
 * v1.17.1 — reference-range badge.
 *
 * Renders the server-computed `rangeStatus` as a calm, informative marker.
 * The project's no-alarming-colour ethos is a hard rule here: an
 * out-of-range value is NOT painted red. It reads as a neutral `secondary`
 * badge with a quiet direction arrow (↓ below / ↑ above), exactly the same
 * weight as the in-range and unknown states. The number leaving the
 * reference window is information a clinician scans — not an alarm to the
 * user, who may be perfectly aware of (and managing) the value.
 *
 * `unknown` (the lab reported no usable bounds) renders nothing — there is
 * no verdict to show, and an empty badge would be noise.
 */
export function ReferenceRangeBadge({
  status,
  compact = false,
  className,
}: {
  status: ReferenceRangeStatus;
  /**
   * v1.18.10 (#4) — a quieter, smaller treatment for the labs overview, where
   * the badge sits beside the analyte heading and must not compete with it.
   * The hero/detail view keeps the default (un-compact) size.
   */
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslations();

  if (status === "unknown") return null;

  // Compact: a quieter, smaller pill beside the analyte heading, so it reads
  // as a qualifier of the heading rather than a second focal point.
  const compactClass = compact ? "gap-0.5 px-1.5 py-0 font-normal" : "";

  if (status === "in-range") {
    return (
      <ScorePill tone="neutral" className={cn(compactClass, className)}>
        {compact ? null : <Minus aria-hidden />}
        {t("labs.range.inRange")}
      </ScorePill>
    );
  }

  // Below / above use a restrained semantic tint, distinguished by the
  // arrow direction and label rather than an alarm treatment.
  const Icon = status === "below" ? ArrowDown : ArrowUp;
  const label =
    status === "below" ? t("labs.range.below") : t("labs.range.above");
  return (
    <ScorePill
      tone={status === "below" ? "info" : "warning"}
      className={cn(compactClass, className)}
    >
      <Icon aria-hidden />
      {label}
    </ScorePill>
  );
}
