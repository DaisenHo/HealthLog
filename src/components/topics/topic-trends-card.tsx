"use client";

import dynamic from "next/dynamic";
import { TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TileHeader } from "@/components/insights/tile-header";
import { useTranslations } from "@/lib/i18n/context";
import type { TopicTrend } from "@/lib/topics/stats";

import { useSignalFormat } from "./use-signal-format";

const DeltaSparkline = dynamic(
  () =>
    import("@/components/charts/chart-runtime").then((mod) => ({
      default: mod.DeltaSparkline,
    })),
  { ssr: false, loading: () => null },
);

/**
 * Each recorded signal over the trailing 90 days: the change the fitted line
 * amounts to, beside its weekly means. Below two weeks of days a row says how
 * many it has rather than drawing a slope through a handful of points.
 */
export function TopicTrendsCard({ trends }: { trends: TopicTrend[] }) {
  const { t } = useTranslations();
  const format = useSignalFormat();
  if (trends.length === 0) return null;

  return (
    <Card data-slot="topic-trends">
      <CardHeader>
        <TileHeader
          icon={TrendingUp}
          titleAs="h2"
          title={t("topics.trends.title")}
        />
      </CardHeader>
      <CardContent>
        <ul className="divide-border flex flex-col divide-y">
          {trends.map((trend) => {
            const points = trend.weekly.map((p, i) => ({ i, v: p.value }));
            return (
              <li
                key={trend.key}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                data-slot="topic-trend"
                data-signal={trend.key}
                data-status={trend.status}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {format.label(trend.key)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {trend.status === "ok"
                      ? t("topics.trends.window")
                      : t("topics.trends.insufficient", { count: trend.days })}
                  </p>
                </div>
                {trend.status === "ok" && points.length >= 2 ? (
                  <div className="h-8 w-20 shrink-0" aria-hidden="true">
                    <DeltaSparkline data={points} strokeVar="var(--chart-2)" />
                  </div>
                ) : null}
                {trend.status === "ok" && trend.change !== null ? (
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {format.delta(trend.key, trend.change)}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
