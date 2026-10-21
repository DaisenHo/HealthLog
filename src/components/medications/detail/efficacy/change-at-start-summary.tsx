"use client";

/**
 * The segmented-regression read-out on a Wirkung target card: the level
 * change and the change in weekly trend at the start, each with its 95 %
 * range, in plain sentences, followed by what the fit rests on (days used,
 * days left out and why) and the other medication changes it cannot separate
 * from this one. Renders the server DTO; recomputes nothing.
 */
import type { EfficacySegmented } from "@/lib/medications/efficacy/segmented-effect";
import { formatEstimate } from "@/lib/medications/efficacy/segmented-format";
import { useFormatters, useTranslations } from "@/lib/i18n/context";

const CONFOUNDER_KEYS = {
  started: "medications.efficacy.segmented.confounderStarted",
  stopped: "medications.efficacy.segmented.confounderStopped",
  dose_change: "medications.efficacy.segmented.confounderDoseChange",
  paused: "medications.efficacy.segmented.confounderPaused",
  resumed: "medications.efficacy.segmented.confounderResumed",
} as const;

const NEED_KEYS = {
  no_start: "medications.efficacy.segmented.needStart",
  insufficient_before: "medications.efficacy.segmented.needBefore",
  insufficient_after: "medications.efficacy.segmented.needAfter",
  fit_failed: "medications.efficacy.segmented.fitFailed",
} as const;

export function ChangeAtStartSummary({
  segmented,
  unit,
  minDays,
  minSpanDays,
}: {
  segmented: EfficacySegmented;
  unit: string | null;
  minDays: number;
  minSpanDays: number;
}) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const num = (v: number, d: number) => fmt.number(v, d);
  const u = unit ?? "";

  if (
    !segmented.present ||
    !segmented.levelChange ||
    !segmented.slopeChangePerWeek ||
    !segmented.preSlopePerWeek ||
    !segmented.window
  ) {
    return (
      <div
        className="border-border/60 rounded-lg border border-dashed p-3"
        data-slot="medication-wirkung-segmented-empty"
      >
        <p className="text-muted-foreground text-sm">
          {t(NEED_KEYS[segmented.reason ?? "fit_failed"], {
            days: minDays,
            span: minSpanDays,
          })}
        </p>
      </div>
    );
  }

  const level = formatEstimate(segmented.levelChange, num);
  const slope = formatEstimate(segmented.slopeChangePerWeek, num);
  const pre = formatEstimate(segmented.preSlopePerWeek, num);
  const anyZero =
    segmented.levelChange.includesZero ||
    segmented.slopeChangePerWeek.includesZero;

  return (
    <div
      className="bg-muted/40 space-y-2 rounded-lg p-3"
      data-slot="medication-wirkung-segmented"
    >
      <p className="text-foreground text-sm font-medium">
        {t("medications.efficacy.segmented.title")}
      </p>
      <p className="text-foreground text-sm">
        {t("medications.efficacy.segmented.level", { ...level, unit: u })}
      </p>
      <p className="text-foreground text-sm">
        {t("medications.efficacy.segmented.slope", { ...slope, unit: u })}
      </p>
      <p className="text-muted-foreground text-xs">
        {t("medications.efficacy.segmented.preSlope", {
          value: pre.value,
          unit: u,
        })}
      </p>
      {anyZero ? (
        <p className="text-foreground text-sm">
          {t("medications.efficacy.segmented.includesZero")}
        </p>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {t("medications.efficacy.segmented.basis", {
          before: segmented.days.before,
          after: segmented.days.after,
          from: fmt.dateShortSmartCalendar(segmented.window.from),
          to: fmt.dateShortSmartCalendar(segmented.window.to),
        })}
      </p>
      {segmented.days.excludedLowAdherence > 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("medications.efficacy.segmented.excludedAdherence", {
            count: segmented.days.excludedLowAdherence,
            floor: segmented.adherence.floorPct,
            lookback: segmented.adherence.lookbackDays,
          })}
        </p>
      ) : null}
      {segmented.days.excludedNotTaking > 0 ? (
        <p className="text-muted-foreground text-xs">
          {t("medications.efficacy.segmented.excludedNotTaking", {
            count: segmented.days.excludedNotTaking,
          })}
        </p>
      ) : null}
      {segmented.adherence.status === "not_tracked" ? (
        <p className="text-muted-foreground text-xs">
          {t("medications.efficacy.segmented.notTracked")}
        </p>
      ) : null}
      {segmented.window.endReason === "dose_change" ? (
        <p className="text-muted-foreground text-xs">
          {t("medications.efficacy.segmented.endDoseChange")}
        </p>
      ) : null}
      {segmented.confounders.length > 0 ? (
        <div data-slot="medication-wirkung-confounders">
          <p className="text-foreground text-sm">
            {t("medications.efficacy.segmented.confoundersTitle")}
          </p>
          <ul className="text-foreground list-disc pl-4 text-sm">
            {segmented.confounders.map((c) => (
              <li key={`${c.medicationName}:${c.event}:${c.date}`}>
                {t(CONFOUNDER_KEYS[c.event], {
                  name: c.medicationName,
                  date: fmt.dateShortSmartCalendar(c.date),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="text-muted-foreground text-xs">
        {t("medications.efficacy.segmented.method")}
      </p>
    </div>
  );
}
