"use client";

/**
 * The segmented control: a short row of mutually exclusive choices on one
 * track (zoom level, chronicle grouping, cards or table, recent or all,
 * Paperless-ngx or Papra). One look everywhere: a muted track, the chosen
 * segment raised on the background colour, never coloured.
 *
 * Two semantics, one chrome:
 *
 * - `mode="radio"` (default): an ARIA radiogroup with one tab stop and arrow
 *   keys through the shared roving helper. `onChange` fires on every press,
 *   the chosen segment included, because a segment can open something (the
 *   timeline's custom range re-opens its popover).
 * - `mode="toggle"`: buttons with `aria-pressed`, for a view switch and for a
 *   choice inside a form sheet (the sheets' discard guard reads any checked
 *   radio as the person's input, and a precision that starts on "Day" is a
 *   default, not an answer). Pressing the active segment does nothing, so a
 *   setter that saves a preference is not called twice.
 *
 * Touch: every segment is at least 44 px on a coarse pointer and 36 px under
 * a mouse, the same floor `Button` carries. The four controls this replaced
 * sat at 36, 36, 44 and 44.
 *
 * An option with an `icon` and `iconOnly` on the control renders the icon and
 * names the segment through `aria-label` and `title`.
 */
import { Fragment, type ReactElement, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { useRovingRadioGroup } from "@/hooks/use-roving-radio-group";
import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Rendered after the label (a connected check beside a system name). */
  trailing?: ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** `data-slot` of the group. */
  slot?: string;
  /**
   * `data-slot` of one segment. Defaults to `${slot}-${value}` when the group
   * has a slot.
   */
  optionSlot?: (value: T) => string;
  mode?: "radio" | "toggle";
  /** Render the options' icons only; the label becomes the accessible name. */
  iconOnly?: boolean;
  /** Spread the segments over the full width. */
  stretch?: boolean;
  disabled?: boolean;
  className?: string;
  /**
   * Wraps one segment's button, for a popover anchored to it (the range
   * segment). Returns the button itself for every other segment.
   */
  wrapOption?: (value: T, button: ReactElement) => ReactNode;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  slot,
  optionSlot,
  mode = "radio",
  iconOnly = false,
  stretch = false,
  disabled = false,
  className,
  wrapOption,
}: SegmentedProps<T>) {
  const selectedIndex = options.findIndex((o) => o.value === value);
  const { getRadioProps } = useRovingRadioGroup({
    count: options.length,
    selectedIndex,
    onSelect: (index) => {
      if (!disabled) onChange(options[index].value);
    },
  });
  const segmentSlot =
    optionSlot ?? (slot ? (v: T) => `${slot}-${v}` : undefined);

  return (
    <div
      role={mode === "toggle" ? "group" : "radiogroup"}
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-slot={slot}
      className={cn(
        "bg-muted inline-flex shrink-0 items-center gap-0.5 rounded-lg p-0.5",
        stretch && "flex w-full",
        className,
      )}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        const Icon = option.icon;
        const button = (
          <button
            key={option.value}
            type="button"
            {...(mode === "toggle"
              ? { "aria-pressed": checked }
              : {
                  role: "radio",
                  "aria-checked": checked,
                  ...getRadioProps(index),
                })}
            {...(iconOnly
              ? { "aria-label": option.label, title: option.label }
              : {})}
            disabled={disabled}
            data-value={option.value}
            data-slot={segmentSlot?.(option.value)}
            onClick={() => {
              if (mode === "toggle" && checked) return;
              onChange(option.value);
            }}
            className={cn(
              "focus-visible:ring-ring/50 inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none",
              iconOnly
                ? "size-9 pointer-coarse:size-11"
                : "min-h-9 px-3 pointer-coarse:min-h-11",
              stretch && "flex-1",
              checked
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon ? (
              <Icon className="size-4 shrink-0" aria-hidden="true" />
            ) : null}
            {iconOnly ? null : option.label}
            {iconOnly ? null : option.trailing}
          </button>
        );
        return wrapOption ? (
          <Fragment key={option.value}>
            {wrapOption(option.value, button)}
          </Fragment>
        ) : (
          button
        );
      })}
    </div>
  );
}
