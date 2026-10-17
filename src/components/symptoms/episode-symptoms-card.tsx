"use client";

/**
 * "Symptoms logged" on an episode's detail page (v1.40): the person's own
 * symptom occurrences filed against this episode, and only those. Renders
 * nothing when there are none, so an episode without them looks exactly as
 * before.
 *
 * Filed means `SymptomEvent.episodeId`, the link the "during" selector of the
 * entry and edit sheets writes. Until v1.43.4 this card also listed every
 * occurrence that merely fell inside the episode's span, so a long-running
 * condition showed the symptoms of every other illness overlapping it, and
 * choosing an illness in the sheet changed nothing visible. The time span
 * decides which episodes the selector offers; it never assigns.
 */
import { useMemo } from "react";
import { Activity } from "lucide-react";

import { TileHeader } from "@/components/insights/tile-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { QueryErrorCard } from "@/components/ui/query-error-card";
import { useAuth } from "@/hooks/use-auth";
import { useRecordCapabilities } from "@/hooks/use-record-capabilities";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import { DEFAULT_TIMEZONE } from "@/lib/tz/format";

import {
  groupEventsByDay,
  SymptomEventMenu,
  SymptomEventRow,
} from "./symptoms-section";
import { useSymptomDefinitions, useSymptomEvents } from "./use-symptoms";

/** The whole history: a filed occurrence may lie anywhere in time. */
const FILED_FROM = "1900-01-01T00:00:00.000Z";
const FILED_TO = "9999-12-31T23:59:59.999Z";

export function EpisodeSymptomsCard({ episode }: { episode: { id: string } }) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const { user } = useAuth();
  const { canManageDomain } = useRecordCapabilities();
  const canManage = canManageDomain("illness");
  const timezone = user?.timezone ?? DEFAULT_TIMEZONE;

  const definitions = useSymptomDefinitions(true);
  const filed = useSymptomEvents(FILED_FROM, FILED_TO, {
    episodeId: episode.id,
  });

  // The route already narrows to the link; the guard keeps a stale or wider
  // answer from ever showing another episode's occurrence here.
  const events = useMemo(
    () =>
      (filed.data?.events ?? []).filter(
        (event) => event.episodeId === episode.id,
      ),
    [filed.data, episode.id],
  );

  if (definitions.isError || filed.isError) {
    return (
      <QueryErrorCard
        title={t("symptoms.section.loadError")}
        onRetry={() => {
          void definitions.refetch();
          void filed.refetch();
        }}
      />
    );
  }
  if (events.length === 0) return null;

  const byId = new Map(
    (definitions.data?.definitions ?? []).map((d) => [d.id, d]),
  );
  const days = groupEventsByDay(events, timezone);

  return (
    <Card data-testid="episode-symptoms-card">
      <CardHeader>
        <TileHeader
          icon={Activity}
          title={t("symptoms.episode.title")}
          titleAs="h2"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {days.map((group) => (
          <section key={group.day} className="space-y-0.5">
            <h3 className="text-sm font-medium">
              {fmt.dateWithWeekdaySmart(group.at)}
            </h3>
            <ul className="divide-border divide-y">
              {group.events.map((event) => {
                const definition = byId.get(event.definitionId);
                const label =
                  definition?.label ?? t("symptoms.unreadableLabel");
                return (
                  <SymptomEventRow
                    key={event.id}
                    event={event}
                    definition={definition}
                    actions={
                      canManage ? (
                        <SymptomEventMenu event={event} label={label} />
                      ) : undefined
                    }
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
