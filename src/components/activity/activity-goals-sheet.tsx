"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { useSaveActivityGoals } from "@/hooks/use-activity-calendar";
import {
  ACTIVITY_GOAL_BOUNDS,
  ACTIVITY_GOAL_KEYS,
  type ActivityGoalKey,
} from "@/lib/activity/goal-bounds";
import { useFormatters, useTranslations } from "@/lib/i18n/context";

type Goals = Record<ActivityGoalKey, number | null>;
type Draft = Record<ActivityGoalKey, string>;

function toDraft(goals: Goals): Draft {
  return Object.fromEntries(
    ACTIVITY_GOAL_KEYS.map((k) => [
      k,
      goals[k] === null ? "" : String(goals[k]),
    ]),
  ) as Draft;
}

/**
 * Parse one field. Blank clears the goal; anything else must be a whole
 * number inside the bounds the server enforces. Digits only, so a grouping
 * separator typed by habit ("10.000") is refused rather than misread.
 */
export function parseGoalField(
  key: ActivityGoalKey,
  raw: string,
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false };
  const value = Number(trimmed);
  const { min, max } = ACTIVITY_GOAL_BOUNDS[key];
  if (value < min || value > max) return { ok: false };
  return { ok: true, value };
}

/**
 * Set or clear the activity goals. Every goal is optional; an empty field is
 * no goal. There is no suggested number: the goal is the person's own.
 *
 * The draft starts from `goals` when the sheet mounts; the caller remounts it
 * on every open (a `key`), so a reopened sheet never shows a stale draft.
 */
export function ActivityGoalsSheet({
  open,
  onOpenChange,
  goals,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  goals: Goals;
}) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const save = useSaveActivityGoals();
  const [draft, setDraft] = useState<Draft>(() => toDraft(goals));
  const [invalid, setInvalid] = useState<ActivityGoalKey[]>([]);

  const submit = () => {
    const bad: ActivityGoalKey[] = [];
    const patch: Partial<Goals> = {};
    for (const key of ACTIVITY_GOAL_KEYS) {
      const parsed = parseGoalField(key, draft[key]);
      if (!parsed.ok) bad.push(key);
      else patch[key] = parsed.value;
    }
    setInvalid(bad);
    if (bad.length > 0) return;
    save.mutate(patch, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("activityCalendar.goalsSheet.title")}
      description={t("activityCalendar.goalsSheet.description")}
      footer={
        <Button
          type="button"
          size="sm"
          className="min-h-11"
          data-slot="activity-goals-save"
          disabled={save.isPending}
          onClick={submit}
        >
          {t("common.save")}
        </Button>
      }
    >
      <form
        className="grid gap-4"
        data-slot="activity-goals-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {ACTIVITY_GOAL_KEYS.map((key) => {
          const id = `activity-goal-${key}`;
          const { min, max } = ACTIVITY_GOAL_BOUNDS[key];
          const isInvalid = invalid.includes(key);
          return (
            <div key={key} className="grid gap-1.5">
              <Label htmlFor={id}>{t(`activityCalendar.goal.${key}`)}</Label>
              <Input
                id={id}
                inputMode="numeric"
                autoComplete="off"
                value={draft[key]}
                aria-invalid={isInvalid || undefined}
                aria-describedby={isInvalid ? `${id}-error` : undefined}
                placeholder={t("activityCalendar.goalsSheet.none")}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, [key]: e.target.value }))
                }
              />
              {isInvalid ? (
                <p
                  id={`${id}-error`}
                  role="alert"
                  className="text-destructive text-xs"
                >
                  {t("activityCalendar.goalsSheet.invalid", {
                    min: fmt.integer(min),
                    max: fmt.integer(max),
                  })}
                </p>
              ) : null}
            </div>
          );
        })}
        {save.isError ? (
          <p role="alert" className="text-destructive text-sm">
            {t("activityCalendar.goalsSheet.saveError")}
          </p>
        ) : null}
      </form>
    </ResponsiveSheet>
  );
}
