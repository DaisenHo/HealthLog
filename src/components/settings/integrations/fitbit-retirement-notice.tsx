"use client";

import { ArrowDown, ExternalLink } from "lucide-react";

import { InlineAction } from "@/components/ui/inline-action";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { FitbitRetirement } from "@/lib/fitbit/retirement";

import { integrationDocsHref } from "./setup-guide-link";

/**
 * The end of the legacy Fitbit Web API, on the Fitbit card. Before the day it
 * says when the connection stops; from the day on, that it has stopped. Both
 * name the way on: Google Health reads the same devices, needs one more
 * consent, and leaves everything already imported in place. The server owns
 * the date and whether it has passed (`retirement` on the status envelope).
 */
export function FitbitRetirementNotice({
  retirement,
}: {
  retirement: FitbitRetirement | undefined;
}) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  if (!retirement) return null;
  const date = fmt.dateShortSmartCalendar(retirement.endsOn);
  return (
    <div
      role="note"
      data-testid="fitbit-retirement-notice"
      data-ended={retirement.ended ? "true" : "false"}
      className="border-warning/40 bg-warning/5 text-foreground mb-3 space-y-2 rounded-md border px-3 py-2 text-sm"
    >
      <p>
        {retirement.ended
          ? t("settings.fitbitRetirement.ended", { date })
          : t("settings.fitbitRetirement.ending", { date })}
      </p>
      <p>{t("settings.fitbitRetirement.move")}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <InlineAction asChild size="sm">
          <a href="#google-health" data-testid="fitbit-retirement-to-google">
            {t("settings.fitbitRetirement.toCard")}
            <ArrowDown className="size-3" aria-hidden="true" />
          </a>
        </InlineAction>
        <InlineAction asChild size="sm">
          <a
            href={integrationDocsHref("google-health")}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="fitbit-retirement-guide"
          >
            {t("settings.fitbitRetirement.guide")}
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        </InlineAction>
      </div>
    </div>
  );
}
