"use client";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import type { TopicHeadline, TopicSummary } from "@/lib/topics/build";
import { cn } from "@/lib/utils";

import { INSTRUMENT_LABEL } from "./topic-meta";
import { useSignalFormat } from "./use-signal-format";

/**
 * The topic's one sentence, worded from the server's code. The rule that
 * picked the code lives in `src/lib/topics/build.ts`; this only says it.
 */
export function useSummarySentence(summary: TopicSummary): string {
  const { t } = useTranslations();
  const signals = useSignalFormat();
  switch (summary.code) {
    case "outside":
      return t(
        summary.direction === "below"
          ? "topics.summary.outsideBelow"
          : "topics.summary.outsideAbove",
        { signal: summary.signal ? signals.label(summary.signal) : "" },
      );
    case "labs":
      return t("topics.summary.labs", {
        count: summary.count ?? 0,
        total: summary.total ?? 0,
      });
    case "cycleDay":
      return t("topics.summary.cycleDay", { day: summary.count ?? 0 });
    case "steady":
      return summary.count === summary.total
        ? t("topics.summary.steadyAll")
        : t("topics.summary.steadySome", {
            count: summary.count ?? 0,
            total: summary.total ?? 0,
          });
    case "learning":
      return t("topics.summary.learning");
    default:
      return t("topics.summary.empty");
  }
}

export function TopicSummaryText({
  summary,
  className,
}: {
  summary: TopicSummary;
  className?: string;
}) {
  const sentence = useSummarySentence(summary);
  return (
    <p
      data-slot="topic-summary"
      data-code={summary.code}
      className={cn("text-foreground", className)}
    >
      {sentence}
    </p>
  );
}

/** The headline as a value and a unit, for whichever kind the server sent. */
export function useHeadline(
  headline: TopicHeadline | null,
): { value: string; unit: string } | null {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const signals = useSignalFormat();
  if (!headline) return null;
  switch (headline.kind) {
    case "signal":
      return {
        value: signals.number(headline.key, headline.value),
        unit: signals.unit(headline.key),
      };
    case "labs":
      return {
        value: t("topics.headline.labsValue", {
          count: headline.inRange,
          total: headline.total,
        }),
        unit: t("topics.headline.labsUnit"),
      };
    case "cycleDay":
      return {
        value: t("topics.headline.cycleDay", { day: headline.dayOfCycle }),
        unit: "",
      };
    case "screener":
      return {
        value: `${INSTRUMENT_LABEL[headline.instrument] ?? headline.instrument} ${fmt.number(headline.score, 0)}`,
        unit: "",
      };
  }
}
