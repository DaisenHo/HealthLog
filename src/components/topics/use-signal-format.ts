"use client";

/**
 * How a topic signal reads on screen: its name, a value in the person's own
 * units, and a signed change. Measurement types go through the same unit
 * display every metric page uses (`useUnitDisplay`), so a topic never shows a
 * number its metric page would write differently; sleep reads as hours and
 * minutes, the mood score as its 1–5 value.
 */
import { useMemo } from "react";

import { useUnitDisplay } from "@/hooks/use-unit-display";
import { formatDurationMinutes } from "@/lib/i18n/duration";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import { MEASUREMENT_TYPE_LABEL_KEYS } from "@/lib/measurements/type-label-keys";
import { rawDisplayFractionDigits } from "@/lib/measurements/display-transform";
import { vitalDisplayDecimals } from "@/lib/measurements/vital-precision";
import { MOOD_SIGNAL } from "@/lib/topics/registry";

/**
 * Whole numbers for counts (steps, minutes) and for the vitals every device
 * reads whole (pulse, blood pressure, HRV, SpO2); one decimal for weight and
 * temperature; a converted unit at its transform's precision. The same
 * answer the Today overview and the server-side texts give.
 */
const WHOLE_VITALS = new Set([
  "PULSE",
  "RESTING_HEART_RATE",
  "HEART_RATE_VARIABILITY",
  "HRV_RMSSD",
  "BLOOD_PRESSURE_SYS",
  "BLOOD_PRESSURE_DIA",
  "OXYGEN_SATURATION",
  "RESPIRATORY_RATE",
  "WALKING_HEART_RATE_AVERAGE",
]);

function signalDigits(key: string, transformDecimals: number): number {
  if (rawDisplayFractionDigits(key) === 0) return 0;
  if (WHOLE_VITALS.has(key))
    return vitalDisplayDecimals(key, transformDecimals);
  return transformDecimals;
}

export interface SignalFormat {
  label: (key: string) => string;
  /** The value with its unit, as one string. */
  value: (key: string, raw: number) => string;
  /** The number alone, in display units. */
  number: (key: string, raw: number) => string;
  unit: (key: string) => string;
  /** A signed change with its unit ("+1.2 kg", "−4 ms"). */
  delta: (key: string, raw: number) => string;
  /** The size of a change with its unit, unsigned ("1.2 kg"). */
  amount: (key: string, raw: number) => string;
}

export function useSignalFormat(): SignalFormat {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const units = useUnitDisplay();

  return useMemo(() => {
    const label = (key: string) => {
      if (key === MOOD_SIGNAL) return t("topics.signals.mood");
      const labelKey =
        MEASUREMENT_TYPE_LABEL_KEYS[
          key as keyof typeof MEASUREMENT_TYPE_LABEL_KEYS
        ];
      return labelKey ? t(labelKey) : key;
    };
    const number = (key: string, raw: number) => {
      if (key === MOOD_SIGNAL) return fmt.number(raw, 1);
      if (key === "SLEEP_DURATION") return formatDurationMinutes(raw, t);
      return fmt.number(
        units.toDisplay(key, raw),
        signalDigits(key, units.decimalsFor(key)),
      );
    };
    const unit = (key: string) => {
      if (key === MOOD_SIGNAL) return t("topics.units.moodScale");
      if (key === "SLEEP_DURATION") return "";
      return units.unitFor(key);
    };
    const value = (key: string, raw: number) => {
      const u = unit(key);
      return u ? `${number(key, raw)} ${u}` : number(key, raw);
    };
    const amount = (key: string, raw: number) => {
      const magnitude = Math.abs(raw);
      if (key === "SLEEP_DURATION") return formatDurationMinutes(magnitude, t);
      const shown =
        key === MOOD_SIGNAL
          ? fmt.number(magnitude, 1)
          : fmt.number(
              Math.abs(units.toDisplayDelta(key, magnitude)),
              signalDigits(key, units.decimalsFor(key)),
            );
      const u = unit(key);
      return u ? `${shown} ${u}` : shown;
    };
    const delta = (key: string, raw: number) => {
      const sign = raw > 0 ? "+" : raw < 0 ? "−" : "±";
      return `${sign}${amount(key, raw)}`;
    };
    return { label, value, number, unit, delta, amount };
  }, [t, fmt, units]);
}

export interface SignalAxis {
  /** A stored value in the unit a chart axis draws (sleep in hours). */
  toAxis: (key: string, raw: number) => number;
  /** Back from the axis unit to the stored value. */
  fromAxis: (key: string, value: number) => number;
  /** A bare axis tick. */
  tick: (key: string, value: number) => string;
}

/** How a signal draws on a chart axis, in the person's own units. */
export function useSignalAxis(): SignalAxis {
  const fmt = useFormatters();
  const units = useUnitDisplay();
  return useMemo(() => {
    const plain = (key: string) =>
      key === MOOD_SIGNAL || key === "SLEEP_DURATION";
    return {
      toAxis: (key, raw) =>
        key === "SLEEP_DURATION"
          ? raw / 60
          : key === MOOD_SIGNAL
            ? raw
            : units.toDisplay(key, raw),
      fromAxis: (key, value) =>
        key === "SLEEP_DURATION"
          ? value * 60
          : key === MOOD_SIGNAL
            ? value
            : units.fromDisplay(key, value),
      tick: (key, value) =>
        fmt.number(
          value,
          plain(key) ? 1 : signalDigits(key, units.decimalsFor(key)),
        ),
    };
  }, [fmt, units]);
}
