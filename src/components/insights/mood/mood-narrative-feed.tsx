"use client";

import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Clock,
  Flame,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import type { ComponentType } from "react";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * v1.8.6 — narrative takeaway feed.
 *
 * The "read this first" layer above the mood charts: a ranked, compact
 * list of plain-language takeaways the server already gated on its
 * thresholds. The component is a pure renderer — every gating decision
 * lives in `computeMoodNarratives`, so an empty array renders nothing
 * (no platitude placeholders). Each row resolves its i18n template with
 * the server-supplied vars; the weekday key is itself an i18n key so it
 * localises with the rest of the bundle. Notes render as plain React
 * text children (no markdown library — XSS posture).
 */

export interface MoodNarrativeItem {
  kind: string;
  messageKey: string;
  vars: Record<string, string>;
}

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "weekday-dip": TrendingDown,
  "weekday-peak": CalendarDays,
  trend: TrendingUp,
  weekend: CalendarDays,
  "tag-lift": ArrowUpRight,
  "tag-drop": ArrowDownRight,
  "in-target": Target,
  streak: Flame,
  "time-of-day": Clock,
};

function pickIcon(item: MoodNarrativeItem): ComponentType<{
  className?: string;
}> {
  if (item.kind === "trend") {
    return item.vars.direction === "down" ? TrendingDown : TrendingUp;
  }
  if (item.kind === "weekend") {
    return item.vars.direction === "down" ? ArrowDownRight : ArrowUpRight;
  }
  return ICONS[item.kind] ?? Tag;
}

/** Vars carrying a one-decimal score figure (`mood-narratives.ts`). */
const DECIMAL_VARS = ["delta", "value"] as const;

export function MoodNarrativeFeed({ items }: { items: MoodNarrativeItem[] }) {
  const { t } = useTranslations();
  const fmt = useFormatters();

  if (items.length === 0) return null;

  return (
    // v1.12.4 — the takeaways are short one-liners, so a single
    // full-width column wasted horizontal space and stacked into a long
    // ladder. Lay them two-up on anything wider than a phone; a lone
    // takeaway still spans the row rather than orphaning half of it.
    <ul
      className={cn(
        "grid gap-2",
        // A lone takeaway spans the row rather than orphaning half of it;
        // two or more lay out two-up on anything wider than a phone.
        items.length > 1 && "sm:grid-cols-2",
      )}
      data-slot="mood-narrative-feed"
      aria-label={t("insights.mood.narrative.title")}
    >
      {items.map((item, index) => {
        const Icon = pickIcon(item);
        // The weekday key is itself an i18n key — resolve it before
        // interpolating so the sentence reads in the active locale. A
        // structured tag→mood takeaway carries its catalog `tagKey`
        // (an i18n key) the same way; flat tags supply `tag` verbatim.
        const vars: Record<string, string> = { ...item.vars };
        if (vars.weekdayKey) vars.weekday = t(vars.weekdayKey);
        if (vars.tagKey) vars.tag = t(vars.tagKey);
        if (vars.bucketKey) vars.bucket = t(vars.bucketKey);
        // The server spells the score figures with a full stop so they
        // survive JSON unchanged; they are printed in the reader's notation.
        for (const name of DECIMAL_VARS) {
          const raw = vars[name];
          const value = raw === undefined ? Number.NaN : Number(raw);
          if (Number.isFinite(value)) vars[name] = fmt.number(value, 1);
        }
        return (
          <li
            key={`${item.kind}-${index}`}
            className="bg-card border-border flex h-full items-start gap-3 rounded-lg border p-3"
          >
            <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="text-foreground/90 text-sm leading-snug">
              {t(item.messageKey, vars)}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
