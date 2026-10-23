import type { Formatters } from "@/lib/format-locale";

import type { BiomarkerTrendDto } from "./types";

type Translate = (
  key: string,
  params?: Record<string, string | number>,
) => string;

/**
 * The two sentences a lab trend reads as: the slope across the readings, and
 * where the straight line would meet the reference band (or why it is not
 * drawn). Shared by the marker page's trend card and the metabolism topic, so
 * one trend is never worded two ways.
 */
export function labTrendLines(
  trend: Extract<BiomarkerTrendDto, { status: "ok" }>,
  unit: string,
  t: Translate,
  fmt: Formatters,
): { slope: string; projection: string | null } {
  const digits = Math.abs(trend.slopePerYear) >= 10 ? 0 : 2;
  const direction =
    trend.slopePerYear > 0
      ? "rising"
      : trend.slopePerYear < 0
        ? "falling"
        : "flat";
  const slope = t(`labs.trend.slope.${direction}`, {
    amount: fmt.number(Math.abs(trend.slopePerYear), digits),
    unit,
    n: trend.n,
    since: fmt.dateShortSmartCalendar(trend.firstAt),
  });
  const projection =
    trend.projection === "exits" && trend.exitDate
      ? t(`labs.trend.projection.exits.${trend.exitBound ?? "high"}`, {
          date: fmt.dateShortSmartCalendar(trend.exitDate),
        })
      : trend.projection === "no_band"
        ? null
        : trend.projection === "stale"
          ? t("labs.trend.projection.stale", {
              date: fmt.dateShortSmartCalendar(trend.lastAt),
            })
          : trend.projection === "beyond_horizon"
            ? t(
                trend.horizonCapped
                  ? "labs.trend.projection.beyond_horizon_capped"
                  : "labs.trend.projection.beyond_horizon",
                {
                  years: fmt.number(
                    trend.horizonYears,
                    trend.horizonCapped ? 0 : 1,
                  ),
                },
              )
            : t(`labs.trend.projection.${trend.projection}`);
  return { slope, projection };
}
