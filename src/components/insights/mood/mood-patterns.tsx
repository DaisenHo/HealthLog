"use client";

/**
 * v1.43 (ios #116 item 6) — the mood patterns the server found.
 *
 * Nothing here decides whether a pattern exists: every row is one the server
 * published after its gate (eight days a side, Welch, false discovery
 * control), computed on the mood day. This component only phrases each one.
 * Rows render in the order delivered; a kind this build does not know is
 * skipped rather than guessed at.
 */
import { useFormatters, useTranslations } from "@/lib/i18n/context";

export interface MoodPatternRow {
  id: string;
  kind: string;
  strength: "weak" | "moderate" | "strong";
  direction: "higher" | "lower" | "none";
  values: {
    subject: number;
    comparison: number;
    delta: number;
    weekday?: number;
    tagKey?: string;
    tagLabel?: string;
  };
  sampleSize: { subject: number; comparison: number };
}

const WEEKDAY_KEYS = [
  "charts.weekdaysFull.mon",
  "charts.weekdaysFull.tue",
  "charts.weekdaysFull.wed",
  "charts.weekdaysFull.thu",
  "charts.weekdaysFull.fri",
  "charts.weekdaysFull.sat",
  "charts.weekdaysFull.sun",
] as const;

/** The sentence key per kind and direction; `none` cannot pass the gate. */
const SENTENCE_KEYS: Record<string, { higher: string; lower: string | null }> =
  {
    previous_day: {
      higher: "insights.mood.patterns.previousDayHigher",
      lower: "insights.mood.patterns.previousDayLower",
    },
    weekend: {
      higher: "insights.mood.patterns.weekendHigher",
      lower: "insights.mood.patterns.weekendLower",
    },
    best_weekday: {
      higher: "insights.mood.patterns.bestWeekday",
      lower: null,
    },
    notes: {
      higher: "insights.mood.patterns.notesHigher",
      lower: "insights.mood.patterns.notesLower",
    },
    delayed_tag: {
      higher: "insights.mood.patterns.delayedTagHigher",
      lower: "insights.mood.patterns.delayedTagLower",
    },
    multiple_entries: {
      higher: "insights.mood.patterns.multipleEntriesHigher",
      lower: "insights.mood.patterns.multipleEntriesLower",
    },
  };

export function MoodPatterns({ patterns }: { patterns: MoodPatternRow[] }) {
  const { t } = useTranslations();
  const fmt = useFormatters();

  const rows = patterns.flatMap((pattern) => {
    const keys = SENTENCE_KEYS[pattern.kind];
    if (!keys || pattern.direction === "none") return [];
    const key = pattern.direction === "higher" ? keys.higher : keys.lower;
    if (!key) return [];
    const weekdayKey =
      pattern.values.weekday !== undefined
        ? WEEKDAY_KEYS[pattern.values.weekday]
        : undefined;
    return [
      {
        id: pattern.id,
        sentence: t(key, {
          subject: fmt.number(pattern.values.subject, 1),
          comparison: fmt.number(pattern.values.comparison, 1),
          weekday: weekdayKey ? t(weekdayKey) : "",
          tag: pattern.values.tagLabel ?? pattern.values.tagKey ?? "",
        }),
        basedOn: t("insights.mood.patterns.basedOn", {
          subject: pattern.sampleSize.subject,
          comparison: pattern.sampleSize.comparison,
        }),
      },
    ];
  });

  if (rows.length === 0) return null;

  return (
    <ul className="space-y-3" data-slot="mood-patterns">
      {rows.map((row) => (
        <li key={row.id} data-pattern-id={row.id} className="space-y-1">
          <p className="text-sm">{row.sentence}</p>
          <p className="text-muted-foreground text-xs">{row.basedOn}</p>
        </li>
      ))}
    </ul>
  );
}
