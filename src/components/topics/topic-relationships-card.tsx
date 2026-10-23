"use client";

import dynamic from "next/dynamic";
import { Info, Link2 } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { TileHeader } from "@/components/insights/tile-header";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { TopicRelationship } from "@/lib/topics/stats";

import { useSignalAxis, useSignalFormat } from "./use-signal-format";

const ScatterCorrelationChart = dynamic(
  () =>
    import("@/components/charts/chart-runtime").then((mod) => ({
      default: mod.ScatterCorrelationChart,
    })),
  { ssr: false, loading: () => <Skeleton className="h-44 w-full" /> },
);

const STATUS_DOT = {
  linked: "bg-chart-1",
  no_clear_link: "bg-muted-foreground",
  insufficient: "bg-border",
} as const;

/** The values' own span with a tenth of it on each side, so dots sit inside. */
function paddedDomain(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.05 || 1;
  return [min - pad, max + pad];
}

/** The one sentence a relationship reads as, from the server's figures. */
function useRelationshipSentence() {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const format = useSignalFormat();
  return (rel: TopicRelationship): { text: string; meta: string | null } => {
    const x = format.label(rel.x);
    const y = format.label(rel.y);
    if (rel.status === "insufficient") {
      return {
        text: t("topics.relationships.insufficient", {
          x,
          y,
          count: rel.pairedDays,
          required: rel.requiredDays,
        }),
        meta: null,
      };
    }
    if (rel.status === "no_clear_link") {
      return {
        text: t("topics.relationships.noClearLink", {
          x,
          y,
          count: rel.pairedDays,
        }),
        meta: null,
      };
    }
    if (rel.kind === "split" && rel.split) {
      const higher = rel.split.difference > 0;
      return {
        text: t(
          higher
            ? "topics.relationships.splitHigher"
            : "topics.relationships.splitLower",
          {
            x,
            y,
            threshold:
              rel.x === "SLEEP_DURATION" && rel.split.threshold % 60 === 0
                ? t("common.durationClockHours", {
                    time: fmt.number(rel.split.threshold / 60, 0),
                  })
                : format.value(rel.x, rel.split.threshold),
            amount: format.amount(rel.y, rel.split.difference),
          },
        ),
        meta: t("topics.relationships.splitDays", {
          below: rel.split.belowDays,
          other: rel.split.otherDays,
        }),
      };
    }
    const higher = (rel.r ?? 0) > 0;
    const key = rel.lagDays === 1 ? "NextDay" : "SameDay";
    return {
      text: t(
        `topics.relationships.correlation${key}${higher ? "Higher" : "Lower"}`,
        { x, y, r: fmt.number(rel.r ?? 0, 2) },
      ),
      meta: t("topics.relationships.pairedDays", { count: rel.pairedDays }),
    };
  };
}

/**
 * How the topic's signals move together: one statement per pair, each with
 * the number of days it rests on, and a scatter for the first pair that holds
 * a pattern. Fourteen paired days before anything is said; never a cause.
 */
export function TopicRelationshipsCard({
  relationships,
}: {
  relationships: TopicRelationship[];
}) {
  const { t } = useTranslations();
  const format = useSignalFormat();
  const axis = useSignalAxis();
  const sentence = useRelationshipSentence();
  if (relationships.length === 0) return null;
  // A scatter only reads for a correlation: a split's x is two groups.
  const featured = relationships.find(
    (r) =>
      r.kind === "correlation" && r.status === "linked" && r.points.length > 0,
  );
  const scatter = featured
    ? featured.points.map((p) => ({
        x: axis.toAxis(featured.x, p.x),
        y: axis.toAxis(featured.y, p.y),
      }))
    : [];

  return (
    <Card data-slot="topic-relationships">
      <CardHeader>
        <TileHeader
          icon={Link2}
          titleAs="h2"
          title={t("topics.relationships.title")}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {featured ? (
          <figure className="flex flex-col gap-1">
            <div aria-hidden="true">
              <ScatterCorrelationChart
                data={scatter}
                fill="var(--chart-1)"
                xAxis={{
                  dataKey: "x",
                  name: format.label(featured.x),
                  domain: paddedDomain(scatter.map((p) => p.x)),
                  tickFormatter: (v) => axis.tick(featured.x, v),
                }}
                yAxis={{
                  dataKey: "y",
                  name: format.label(featured.y),
                  domain: paddedDomain(scatter.map((p) => p.y)),
                  tickFormatter: (v) => axis.tick(featured.y, v),
                }}
                height={176}
              />
            </div>
            <figcaption className="text-muted-foreground text-xs">
              {t("topics.relationships.scatterCaption", {
                x: format.label(featured.x),
                y: format.label(featured.y),
              })}
            </figcaption>
          </figure>
        ) : null}
        <ul className="flex flex-col gap-3">
          {relationships.map((rel) => {
            const { text, meta } = sentence(rel);
            return (
              <li
                key={rel.id}
                className="flex items-start gap-2"
                data-slot="topic-relationship"
                data-relationship={rel.id}
                data-status={rel.status}
              >
                <span
                  aria-hidden="true"
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${STATUS_DOT[rel.status]}`}
                />
                <div className="min-w-0">
                  <p className="text-sm">{text}</p>
                  {meta ? (
                    <p className="text-muted-foreground text-xs">{meta}</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("topics.relationships.footnote")}</span>
        </p>
      </CardContent>
    </Card>
  );
}
