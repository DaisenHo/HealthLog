"use client";

/**
 * Where an integration's imported history ends, when its backfill stopped
 * before the beginning of a data type's history (#1220).
 *
 * Without it a backfill that could not go further either kept the card
 * saying older history was loading, forever, or (once it completes) would
 * leave a gap nobody explained. The server resolves where each type ends and
 * why; this only words it. Each line is two sentences about the user's own
 * data, so it reads as body text (`text-sm`, foreground), not as muted meta.
 */

import { MEASUREMENT_TYPE_LABEL_KEYS } from "@/components/measurements/measurement-list-meta";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { IntegrationStatusViewModel } from "./shared";

export function HistoryEndsNote({
  provider,
  entries,
}: {
  provider: string;
  entries: IntegrationStatusViewModel["backfillEnded"];
}) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  if (!entries?.length) return null;
  return (
    <ul className="space-y-1 text-sm" data-testid={`${provider}-history-ends`}>
      {entries.map((entry) => {
        const labelKey = MEASUREMENT_TYPE_LABEL_KEYS[entry.type];
        const values = {
          type: labelKey ? t(labelKey) : entry.type,
          date: fmt.date(entry.endsAt),
        };
        return (
          <li key={entry.type} data-reason={entry.reason}>
            {entry.reason === "horizon"
              ? t("settings.integrationCard.historyEnds.horizon", values)
              : t("settings.integrationCard.historyEnds.noProgress", values)}
          </li>
        );
      })}
    </ul>
  );
}
