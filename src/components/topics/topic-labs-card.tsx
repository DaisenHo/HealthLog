"use client";

import Link from "next/link";
import { FlaskConical, TrendingUp } from "lucide-react";

import { labTrendLines } from "@/components/labs/lab-trend-lines";
import { useLabNumber } from "@/components/labs/use-lab-format";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScorePill } from "@/components/ui/score-pill";
import { TileHeader } from "@/components/insights/tile-header";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import { formatReferenceRange } from "@/lib/labs/reference-range";
import type { TopicLabMarker, TopicLabPanel } from "@/lib/topics/labs";

function MarkerTile({ marker }: { marker: TopicLabMarker }) {
  const { t } = useTranslations();
  const labNumber = useLabNumber();
  const range = formatReferenceRange(marker.low, marker.high, (v) =>
    labNumber(v),
  );
  const outside = marker.status === "above" || marker.status === "below";
  return (
    <Link
      href={`/labs/${marker.biomarkerId}`}
      data-slot="topic-lab-marker"
      data-status={marker.status}
      className="border-border hover:bg-accent/40 focus-visible:ring-ring/50 flex min-w-0 flex-col gap-1 rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="text-foreground truncate text-xs font-medium">
        {marker.name}
      </span>
      <span className="flex items-baseline gap-1">
        <span className="text-lg font-semibold tabular-nums">
          {labNumber(marker.latest)}
        </span>
        <span className="text-muted-foreground text-xs">{marker.unit}</span>
      </span>
      {range ? (
        <span className="text-muted-foreground text-xs">{range}</span>
      ) : null}
      {outside ? (
        <ScorePill tone="warning" className="self-start">
          {t(`topics.labs.${marker.status}`)}
        </ScorePill>
      ) : null}
    </Link>
  );
}

/**
 * The metabolism topic's lab block: each marker's newest reading against the
 * window it is judged by, then what the markers' trend lines say. A trend
 * needs three readings spanning a year; markers short of that are named in
 * one sentence instead of being given a line.
 */
export function TopicLabsCard({ labs }: { labs: TopicLabPanel }) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const trending = labs.markers.filter((m) => m.trend.status === "ok");
  const short = labs.markers.filter((m) => m.trend.status !== "ok");

  return (
    <Card data-slot="topic-labs">
      <CardHeader>
        <TileHeader
          icon={FlaskConical}
          titleAs="h2"
          title={t("topics.labs.title")}
          right={
            labs.latestOn ? (
              <span className="text-muted-foreground text-xs">
                {fmt.dateShortSmartCalendar(labs.latestOn)}
              </span>
            ) : null
          }
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {labs.markers.map((marker) => (
            <MarkerTile key={marker.biomarkerId} marker={marker} />
          ))}
        </div>
        <section
          className="flex flex-col gap-2"
          aria-labelledby="topic-lab-trends-heading"
        >
          <h3
            id="topic-lab-trends-heading"
            className="text-foreground flex items-center gap-2 text-sm font-semibold"
          >
            <TrendingUp className="size-4" aria-hidden="true" />
            {t("topics.labs.trendsTitle")}
          </h3>
          {trending.map((marker) => {
            if (marker.trend.status !== "ok") return null;
            const lines = labTrendLines(marker.trend, marker.unit, t, fmt);
            return (
              <div
                key={marker.biomarkerId}
                data-slot="topic-lab-trend"
                data-projection={marker.trend.projection}
              >
                <p className="text-sm font-medium">{marker.name}</p>
                <p className="text-sm">{lines.slope}</p>
                {lines.projection ? (
                  <p className="text-sm">{lines.projection}</p>
                ) : null}
              </div>
            );
          })}
          {short.length > 0 ? (
            <p
              className="text-muted-foreground text-xs"
              data-slot="topic-lab-trend-short"
            >
              {t("topics.labs.trendNeeds", {
                markers: short.map((m) => m.name).join(", "),
              })}
            </p>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}
