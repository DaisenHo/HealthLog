"use client";

import { useEffect, useRef, useState } from "react";

/**
 * v1.16.4 — touch-only pull-to-refresh for the PWA's list surfaces.
 *
 * Listens for a downward touch drag that starts with the page scrolled to
 * the very top, applies a 0.5 resistance factor so the gesture reads
 * "elastic", and — when the resisted distance passes `threshold` on
 * release — runs `onRefresh` (typically an "invalidate the visible
 * queries" call). Mouse and trackpad users are untouched: only `touch*`
 * events are observed, so desktop scrolling never arms the gesture.
 *
 * Deliberately does NOT `preventDefault()` the touch moves: the listener
 * stays passive (no scroll-jank), and standalone-PWA contexts already
 * suppress the browser's native refresh via `overscroll-behavior`. The
 * indicator is an overlay, so the content never shifts.
 */

export interface UsePullToRefreshOptions {
  /** Refresh action; the indicator spins until the promise settles. */
  onRefresh: () => Promise<unknown>;
  /** Resisted pull distance (px) that arms the refresh. Default 64. */
  threshold?: number;
  /** True suspends the listeners entirely (e.g. while a sheet is open). */
  disabled?: boolean;
}

export interface PullToRefreshState {
  /** Resisted pull distance in px (0 when idle). */
  pullDistance: number;
  /** True from a passed-threshold release until `onRefresh` settles. */
  refreshing: boolean;
  /** True while the live pull is past the release threshold. */
  armed: boolean;
  threshold: number;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 64,
  disabled = false,
}: UsePullToRefreshOptions): PullToRefreshState {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // The latest refresh callback rides a ref so the touch listeners bind
  // once per `disabled` / `threshold` change, not on every parent render.
  const onRefreshRef = useRef(onRefresh);
  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    if (disabled || typeof window === "undefined") return;

    let startY: number | null = null;
    let pulling = false;
    let busy = false;
    let lastDistance = 0;

    // v1.30.1 — the authenticated shell's actual scroll container is
    // `<main id="main-content">` (`AuthShell` sets it `overflow-y-auto`
    // inside a height-locked `h-dvh` layout); `document.scrollingElement`
    // never moves there; it stays permanently at 0. Checking the document
    // root meant "at top" was always true regardless of how far the user
    // had actually scrolled a long list — a downward drag mid-scroll could
    // arm the pull gesture instead of just scrolling the list. Falls back
    // to the document root for the few body-scrolled surfaces (public
    // pages) that render outside the shell's `#main-content`.
    const atTop = () => {
      const main = document.getElementById("main-content");
      const scrollTop = main
        ? main.scrollTop
        : (document.scrollingElement?.scrollTop ?? window.scrollY);
      return scrollTop <= 0;
    };

    const reset = () => {
      startY = null;
      pulling = false;
      lastDistance = 0;
      setPullDistance(0);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (busy || e.touches.length !== 1 || !atTop()) return;
      startY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (busy || startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || !atTop()) {
        // Upward drag or the page started scrolling — stand down quietly.
        if (pulling) reset();
        return;
      }
      pulling = true;
      // 0.5 resistance + a soft cap keeps the indicator calm.
      lastDistance = Math.min(dy * 0.5, threshold * 1.5);
      setPullDistance(lastDistance);
    };

    const onTouchEnd = () => {
      if (busy || !pulling) {
        startY = null;
        return;
      }
      const release = lastDistance;
      reset();
      if (release < threshold) return;
      busy = true;
      setRefreshing(true);
      void Promise.resolve(onRefreshRef.current())
        .catch(() => {
          // A failed refetch surfaces through the queries themselves; the
          // gesture just winds down.
        })
        .finally(() => {
          busy = false;
          setRefreshing(false);
        });
    };

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd, { passive: true });
    window.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [disabled, threshold]);

  return {
    pullDistance,
    refreshing,
    armed: pullDistance >= threshold,
    threshold,
  };
}
