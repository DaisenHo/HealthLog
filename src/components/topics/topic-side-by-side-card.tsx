"use client";

import dynamic from "next/dynamic";
import { Layers } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TileHeader } from "@/components/insights/tile-header";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { TopicDetail } from "@/lib/topics/build";
import { daysBetweenDateKeys, shiftDateKey } from "@/lib/tz/format";

import { useSignalAxis, useSignalFormat } from "./use-signal-format";

// Recharts loads through the one shared chart chunk, never in this route's own.
const TopicSideBySideChart = dynamic(
  () =>
    import("@/components/charts/chart-runtime").then((mod) => ({
      default: mod.TopicSideBySideChart,
    })),
  { ssr: false, loading: () => <Skeleton className="h-72 w-full" /> },
);

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

/**
 * The topic's signals on one time axis for the chosen window, each against
 * its usual range. Sleep draws in hours on the axis and reads as hours and
 * minutes in the tooltip; every other type in the person's display unit.
 */
export function TopicSideBySideCard({ detail }: { detail: TopicDetail }) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const format = useSignalFormat();
  const { toAxis, fromAxis, tick } = useSignalAxis();
  if (detail.series.length === 0) return null;

  const days = daysBetweenDateKeys(detail.from, detail.to) + 1;

  const series = detail.series.map((s, i) => ({
    key: s.key,
    label: format.label(s.key),
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    points: s.points.map((p) => ({
      x: daysBetweenDateKeys(detail.from, p.day),
      y: toAxis(s.key, p.value),
    })),
    band: s.usual
      ? { low: toAxis(s.key, s.usual.low), high: toAxis(s.key, s.usual.high) }
      : null,
  }));
  const names = series.map((s) => s.label).join(", ");

  return (
    <Card data-slot="topic-side-by-side">
      <CardHeader>
        <TileHeader
          icon={Layers}
          titleAs="h2"
          title={t("topics.chart.title")}
        />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-muted-foreground text-xs">
          {t("topics.chart.legend")}
        </p>
        <div
          role="img"
          aria-label={t("topics.chart.label", { signals: names })}
        >
          <TopicSideBySideChart
            series={series}
            days={days}
            formatDay={(x) =>
              fmt.dateShortSmartCalendar(shiftDateKey(detail.from, x))
            }
            formatValue={(key, value) =>
              format.value(key, fromAxis(key, value))
            }
            formatTick={tick}
          />
        </div>
      </CardContent>
    </Card>
  );
}
