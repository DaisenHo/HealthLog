"use client";

import { useMemo } from "react";

import { cn } from "@/lib/utils";
import { stripChartTokens } from "@/lib/insights/chart-tokens";
import {
  ProseBlocks,
  ProseBlock,
  splitParagraphs,
  PROSE_PARAGRAPH_CLASS,
} from "@/components/insights/prose-blocks";

/**
 * v1.18.9 — Claude-style word-by-word fade-in for the LIVE Coach turn.
 *
 * The provider clients return the whole reply in one shot; the chat route
 * re-chunks it into per-word `token` SSE frames (`tokeniseForStreaming`),
 * so `content` grows as frames land. While the turn is streaming each
 * whitespace segment of the GROWING tail renders as its own `<span>` that
 * fades + drifts up on mount, giving the reply a "thinking out loud"
 * cadence rather than a hard dump of word groups.
 *
 * v1.22 — paragraph-aware + SSE-safe. The reply now renders as real
 * `<p>` blocks (shared `ProseBlocks`), so a model that emits blank-line
 * paragraph breaks reads as paragraphs, not one run-on block — consistent
 * with the daily briefing + insight cards. Under streaming, every COMPLETE
 * paragraph settles immediately (plain text, with the safe Learn linkifier)
 * and only the LAST, still-growing paragraph animates word-by-word. When a
 * fresh `\n\n` arrives the tail becomes a completed paragraph and stops
 * animating; the already-settled paragraphs keep their index keys and never
 * replay. Once the whole turn settles (`streaming === false`) it collapses
 * to the same `ProseBlocks` render the persisted history uses.
 *
 * Why no "only animate the new words" bookkeeping: each tail segment is
 * keyed by its index, so when a fresh SSE frame appends words React keeps
 * the already-mounted spans (their CSS entrance already ran and does not
 * replay on reconcile) and only MOUNTS the new trailing spans — which is
 * exactly when the `animate-in` entrance fires. The browser does the
 * "new words only" gating for us; no render-time ref is needed.
 *
 * CSP-safe: the entrance is Tailwind's `animate-in fade-in-0
 * slide-in-from-bottom-1` (compiled utilities served from `'self'`) plus a
 * per-span inline `animationDelay` / `animationDuration`. Inline `style`
 * attributes are already permitted under the strict CSP
 * (`style-src 'self' 'unsafe-inline'`); there is no runtime-injected
 * `<style>` tag, no `dangerouslySetInnerHTML`, and no markdown library —
 * the text renders as plain React children (with a closed-set Learn
 * linkifier), the XSS-safe path the rest of the Coach uses.
 *
 * `prefers-reduced-motion`: the animation classes are `motion-safe:`
 * gated, so reduced-motion users get the words instantly with no fade and
 * no translate.
 */
export interface StreamedProseProps {
  /** Raw assistant prose (may contain stray chart-token leaks). */
  content: string;
  /**
   * True while the turn is still streaming. When false the prose renders
   * settled as real paragraph blocks (persisted history + finished turns).
   */
  streaming: boolean;
}

/**
 * Split prose into word+trailing-whitespace segments. Mirrors the route's
 * server-side `tokeniseForStreaming` split (`\S+\s*`) so the client-side
 * re-split lines up with how the SSE frames arrived. Exported for tests.
 */
export function splitProseSegments(text: string): string[] {
  return text.match(/\S+\s*/g) ?? (text ? [text] : []);
}

export function StreamedProse({ content, streaming }: StreamedProseProps) {
  // Split paragraphs on the RAW text — `stripChartTokens` normalises
  // whitespace (collapsing the `\n\n` breaks), so it must run per line
  // inside the renderers, never on the whole string before the split.
  const paras = useMemo(
    () => (streaming ? splitParagraphs(content) : []),
    [streaming, content],
  );

  if (!streaming) {
    // Settled turn: real <p> blocks + per-line token strip + the safe Learn
    // linkifier, the same render the persisted history uses.
    return <ProseBlocks text={content} />;
  }

  if (paras.length === 0) return null;

  const tail = paras[paras.length - 1];
  const settled = paras.slice(0, -1);
  // The growing tail animates word-by-word; strip its tokens here so a
  // mid-stream `metric:<TYPE>` leak never flashes into the prose.
  const tailSegments = splitProseSegments(stripChartTokens(tail));

  return (
    <>
      {/* Completed paragraphs settle immediately — plain text + linkifier
          (and real list markup for `- ` runs), identical to the
          non-streaming render so nothing reflows when the turn finishes. */}
      {settled.map((p, i) => (
        <ProseBlock key={i} text={p} strip />
      ))}
      {/* The growing tail paragraph: word-by-word fade. No linkify here —
          a half-arrived URL must not flicker into a link mid-stream; it
          settles (and linkifies) once the turn finishes. */}
      <p key={settled.length} className={cn(PROSE_PARAGRAPH_CLASS)}>
        {tailSegments.map((segment, index) => (
          // New trailing spans mount + animate; already-mounted spans keep
          // their stable index key and do not replay the entrance.
          <span
            key={index}
            className={cn(
              "motion-safe:animate-in motion-safe:fade-in-0",
              "motion-safe:slide-in-from-bottom-1",
            )}
            style={{
              animationDuration: "340ms",
              // A gentle, capped stagger keyed off the in-batch position so a
              // burst of words reads as a soft cascade rather than a single
              // flash, without lagging on a long frame.
              animationDelay: `${(index % 6) * 26}ms`,
              animationFillMode: "both",
            }}
          >
            {segment}
          </span>
        ))}
      </p>
    </>
  );
}
