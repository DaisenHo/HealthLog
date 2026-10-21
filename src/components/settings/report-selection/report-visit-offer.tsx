"use client";

/**
 * "Bericht für den Termin am … erstellen" — the report knows why it is being
 * generated.
 *
 * The cheapest integration in this milestone and the one that changes the most:
 * a person opening the export panel a week before an appointment is almost
 * always opening it BECAUSE of the appointment, and the window they want ends
 * on that day. One query, one prefilled field, one dismissible offer.
 *
 * **It never auto-applies.** The window is not silently changed and then left
 * for the person to discover; the offer names its own source ("weil am … ein
 * Termin ansteht") and does nothing until pressed. A control that moves on its
 * own is the thing that makes an export panel untrustworthy.
 *
 * Pressing it sets both ends of the custom range: the end on the appointment's
 * day, the start where the server put the window before that visit
 * (`EncounterDTO.preparation`: the last visit with the same practitioner, else
 * the same specialty, else the same kind, else the last 90 days). The offer
 * says which, so the start date explains itself, and both dates stay editable.
 * Nothing about the stored selection changes.
 */
import { CalendarClock, X } from "lucide-react";
import { useState } from "react";

import { encounterKindText } from "@/components/encounters/encounter-labels";
import { preparationText } from "@/components/encounters/preparation-text";
import { Button } from "@/components/ui/button";
import { useEncounters, type Encounter } from "@/hooks/use-encounters";
import {
  useDisplayTimezone,
  useFormatters,
  useTranslations,
} from "@/lib/i18n/context";
import type { EncounterKind } from "@/generated/prisma/client";
import { userDayKey } from "@/lib/tz/format";

/**
 * How far ahead a booked visit is treated as the reason for this report.
 *
 * Two weeks: far enough that somebody preparing in advance is offered it, near
 * enough that a routine check-up six months out does not colonise the panel.
 */
export const REPORT_VISIT_HORIZON_DAYS = 14;

/** The report window an appointment offers, as `yyyy-MM-dd` days. */
export interface VisitReportWindow {
  /** The server's start of the window before the visit; null if it has none. */
  from: string | null;
  /** The appointment's own day. */
  to: string;
}

/**
 * What pressing the offer for `visit` applies. Both ends are days of the
 * record's own calendar (`timeZone`, the profile zone): the server cuts
 * `preparation.from` there, and the appointment's day has to be cut in the
 * same zone, or a browser in another zone moved the end a day against the
 * start for a late-evening or early-morning visit.
 */
export function visitReportWindow(
  visit: Encounter,
  timeZone: string,
): VisitReportWindow {
  return {
    from: visit.preparation?.from ?? null,
    to: userDayKey(new Date(visit.occurredAt), timeZone),
  };
}

export function ReportVisitOffer({
  onUseVisitWindow,
}: {
  /** Sets the custom window. Called only on an explicit press. */
  onUseVisitWindow: (window: VisitReportWindow) => void;
}) {
  const { t } = useTranslations();
  const format = useFormatters();
  const timeZone = useDisplayTimezone();
  const [dismissed, setDismissed] = useState(false);
  const visits = useEncounters();

  // Read once, at mount. A clock read during render is impure — and here it
  // would also mean the offer could vanish mid-interaction as a visit crossed
  // the horizon between two renders.
  const [now] = useState(() => Date.now());

  if (dismissed) return null;

  const horizon = now + REPORT_VISIT_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  const next = (visits.data?.upcoming ?? []).find((visit) => {
    if (visit.status !== "PLANNED") return false;
    const at = new Date(visit.occurredAt).getTime();
    return at > now && at <= horizon;
  });
  if (!next) return null;

  const what =
    next.practitioner?.name ?? encounterKindText(t, next.kind as EncounterKind);
  const windowText = next.preparation
    ? preparationText(t, format.dateShortSmartCalendar, next.preparation)
    : null;

  return (
    <div
      data-slot="report-visit-offer"
      className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3"
    >
      {/* Content, not meta: it is the offer, and it names its own source. On
          a phone the sentence takes the full row and the two buttons wrap
          below it; with a zero basis it was squeezed into a one-word column
          beside them. */}
      <div className="text-foreground flex min-w-0 flex-1 basis-full items-start gap-2 text-sm sm:basis-0">
        <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <p>
            {t("settings.healthRecord.visitOffer", {
              what,
              when: format.date(next.occurredAt),
            })}
          </p>
          {/* Where the report would start, and why there: meta, so muted. */}
          {windowText ? (
            <p
              className="text-muted-foreground text-xs"
              data-slot="report-visit-offer-window"
            >
              {windowText.title}
            </p>
          ) : null}
          {windowText?.reason ? (
            <p className="text-muted-foreground text-xs">{windowText.reason}</p>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="ml-auto min-h-11 sm:ml-0 sm:min-h-9"
        data-slot="report-visit-offer-apply"
        onClick={() => onUseVisitWindow(visitReportWindow(next, timeZone))}
      >
        {t("settings.healthRecord.visitOfferApplyWindow")}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 shrink-0 sm:size-9"
        aria-label={t("common.dismiss")}
        onClick={() => setDismissed(true)}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
