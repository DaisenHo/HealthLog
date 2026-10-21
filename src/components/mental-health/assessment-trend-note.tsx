"use client";

import { useFormatters, useTranslations } from "@/lib/i18n/context";

import type { AssessmentTrendDto } from "./types";

/**
 * v1.44 — how the latest score compares with the previous check-in (and,
 * from the third, with the first), against the change size studies treat as
 * meaningful for this instrument. Every number and verdict is the server's;
 * the wording stays neutral: a change, its size, and whether it reaches the
 * threshold. No band words, no advice.
 */
export function AssessmentTrendNote({ trend }: { trend: AssessmentTrendDto }) {
  const { t } = useTranslations();
  const { date: formatDate, number } = useFormatters();
  if (trend.previous === null || trend.changeFromPrevious === null) return null;

  const signed = (delta: number) =>
    delta > 0 ? `+${number(delta, 0)}` : number(delta, 0);
  const line = (
    key: "sincePrevious" | "sinceFirst",
    at: string,
    delta: number,
    verdict: NonNullable<AssessmentTrendDto["sincePrevious"]>,
  ) =>
    `${t(`mentalHealth.trend.${key}`, {
      date: formatDate(at),
      change: signed(delta),
    })} ${t(`mentalHealth.trend.verdict.${verdict}`, {
      threshold: trend.threshold,
    })}`;

  return (
    <div className="space-y-1 text-sm" data-slot="assessment-trend">
      {trend.sincePrevious ? (
        <p data-verdict={trend.sincePrevious}>
          {line(
            "sincePrevious",
            trend.previous.takenAt,
            trend.changeFromPrevious,
            trend.sincePrevious,
          )}
        </p>
      ) : null}
      {trend.n >= 3 && trend.sinceFirst && trend.changeFromFirst !== null ? (
        <p data-verdict={trend.sinceFirst}>
          {line(
            "sinceFirst",
            trend.first.takenAt,
            trend.changeFromFirst,
            trend.sinceFirst,
          )}
        </p>
      ) : null}
    </div>
  );
}
