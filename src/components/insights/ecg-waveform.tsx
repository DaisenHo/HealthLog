"use client";

import { useId, useMemo } from "react";

import { useTranslations, useFormatters } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * v1.28.50 — purpose-built SVG ECG waveform strip.
 *
 * A raw single-lead ECG strip is thousands of micro-volt samples. This is
 * rendered as ONE `<path>` over a classic ECG grid `<pattern>` — NOT
 * Recharts, which builds a per-point React element tree and janks at this
 * point count. A hand-computed polyline `d`-string is one DOM node,
 * renders instantly, re-scales cheaply, is crisp at any zoom, prints
 * cleanly (doctor report / browser print), and can be labelled as a whole
 * image. (This is a new primitive, not a Recharts chart being swapped —
 * the "Recharts stays" rule protects the existing trend charts.)
 *
 * NON-DIAGNOSTIC: this component draws the raw data and nothing else. It
 * places no beat/interval annotation on the trace, no P/QRS/T markers, no
 * grid-derived measurement — the classic 25 mm/s · 10 mm/mV grid here is
 * DECORATIVE calibration chrome for the fit-to-width overview, not a
 * measurement axis. The accessible label reports the device's own result
 * verbatim; it never asserts a HealthLog verdict.
 *
 * Theme-aware via semantic tokens (the tokenised `--brand-pink` grid and
 * `--foreground` trace resolve per light/dark), and `motion-reduce`-safe
 * by construction (no draw-on animation — the path is static).
 */

// Fixed display viewBox. The overview compresses the whole strip to this
// width, so the grid is decorative chrome at a fixed box size rather than a
// time-calibrated axis; the trace maps evenly across the full width.
const VIEW_W = 1000;
const VIEW_H = 320;
// Small ECG box (1 mm) and bold box (5 mm) in viewBox units.
const SMALL_BOX = 8;
const BIG_BOX = SMALL_BOX * 5;
// Vertical inset so the tallest R-wave never clips the top/bottom edge.
const Y_PAD = VIEW_H * 0.12;

export interface EcgWaveformProps {
  /**
   * Micro-volt samples. The x-position of each is implied by its index
   * (evenly mapped across the strip); this is a shape overview, not a
   * calibrated-time axis.
   */
  samples: number[];
  /** ISO recording timestamp — read into the accessible label. */
  recordedAt: string;
  /** Strip duration in seconds (null when the source omitted the rate). */
  durationSeconds: number | null;
  /** Source-reported average heart rate (BPM), when present. */
  averageHeartRate: number | null;
  /**
   * The recording DEVICE's own result, already localised and attributed to
   * the device by the caller (e.g. "Atrial fibrillation detected"). Folded
   * into the accessible label so a screen-reader user hears the device's
   * verdict, never a HealthLog one. Null when the source reported none.
   */
  resultLabel: string | null;
  className?: string;
}

/** Build the polyline `d`-string, mapping samples evenly across the width. */
function buildPath(samples: number[]): string {
  const n = samples.length;
  if (n === 0) return "";

  let min = samples[0];
  let max = samples[0];
  for (let i = 1; i < n; i++) {
    if (samples[i] < min) min = samples[i];
    if (samples[i] > max) max = samples[i];
  }
  const span = max - min || 1; // flat trace → centre it
  const usableH = VIEW_H - 2 * Y_PAD;
  const xStep = n > 1 ? VIEW_W / (n - 1) : 0;

  let d = "";
  for (let i = 0; i < n; i++) {
    const x = i * xStep;
    // Higher voltage → smaller y (up).
    const y = Y_PAD + ((max - samples[i]) / span) * usableH;
    // eslint-disable-next-line healthlog/no-unlocalised-decimal -- SVG coordinates, read by the renderer, not a person
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    if (i < n - 1) d += " ";
  }
  return d;
}

export function EcgWaveform({
  samples,
  recordedAt,
  durationSeconds,
  averageHeartRate,
  resultLabel,
  className,
}: EcgWaveformProps) {
  const { t } = useTranslations();
  const fmt = useFormatters();
  const uid = useId();
  const smallGridId = `ecg-grid-sm-${uid}`;
  const bigGridId = `ecg-grid-lg-${uid}`;

  const d = useMemo(() => buildPath(samples), [samples]);

  // Accessible whole-image label: when + how long + average HR + the
  // DEVICE's result. Non-normal or normal, it is the device's verdict.
  const ariaLabel = t("insights.ecg.waveform.ariaLabel", {
    date: fmt.dateTime(new Date(recordedAt)),
    duration:
      durationSeconds != null
        ? t("insights.ecg.meta.durationValue", {
            seconds: Math.round(durationSeconds),
          })
        : t("insights.ecg.meta.unknown"),
    heartRate:
      averageHeartRate != null
        ? t("insights.ecg.meta.bpmValue", { bpm: averageHeartRate })
        : t("insights.ecg.meta.unknown"),
    result: resultLabel ?? t("insights.ecg.result.none"),
  });

  return (
    <figure
      data-slot="ecg-waveform"
      role="img"
      aria-label={ariaLabel}
      className={cn(
        "bg-card border-border overflow-hidden rounded-lg border",
        className,
      )}
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
      >
        <defs>
          {/* Small 1 mm boxes. */}
          <pattern
            id={smallGridId}
            width={SMALL_BOX}
            height={SMALL_BOX}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${SMALL_BOX} 0 L 0 0 0 ${SMALL_BOX}`}
              fill="none"
              className="stroke-brand-pink/20"
              strokeWidth={0.5}
            />
          </pattern>
          {/* Bold 5 mm boxes. */}
          <pattern
            id={bigGridId}
            width={BIG_BOX}
            height={BIG_BOX}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${BIG_BOX} 0 L 0 0 0 ${BIG_BOX}`}
              fill="none"
              className="stroke-brand-pink/40"
              strokeWidth={1}
            />
          </pattern>
        </defs>
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${smallGridId})`} />
        <rect width={VIEW_W} height={VIEW_H} fill={`url(#${bigGridId})`} />
        {d && (
          <path
            data-slot="ecg-trace"
            d={d}
            fill="none"
            className="stroke-foreground"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
    </figure>
  );
}
