/**
 * The bottom sheet's gesture arithmetic, free of the DOM so every rule can be
 * tested on numbers: when a drag counts, how far the sheet follows, how fast
 * the finger left, and where the sheet comes to rest.
 *
 * Offsets are the sheet's `translateY` in px: 0 is fully raised, positive is
 * further down. A sheet with a preview step rests at `previewOffset` (its
 * full height less the preview height) until it is pulled up to 0.
 */

/** A release this far below the lowest resting place closes the sheet, as a share of the height still visible there. */
export const SHEET_DISMISS_RATIO = 0.25;
/** A downward release faster than this (px/ms) closes the sheet. */
export const SHEET_FLICK_VELOCITY = 0.5;
/** Travel (px) before a touch is read as vertical or sideways. */
export const SHEET_AXIS_SLOP = 8;
/** The most the sheet rises above its top resting place, however far the finger goes. */
export const SHEET_OVERDRAG = 24;
/** Only the movement in this window (ms) before release counts towards the velocity. */
export const SHEET_VELOCITY_WINDOW = 100;

export type SheetAxis = "x" | "y";
export type SheetSnap = "full" | "preview";
export type SheetSettle = { kind: "close" } | { kind: "snap"; snap: SheetSnap };

/**
 * Which way a touch is going, once it has gone far enough to tell. Null while
 * it is still inside the slop. A tie goes sideways, so a diagonal start never
 * takes a slider or a wide table away from its own gesture.
 */
export function lockAxis(
  dx: number,
  dy: number,
  slop: number = SHEET_AXIS_SLOP,
): SheetAxis | null {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return null;
  return Math.abs(dy) > Math.abs(dx) ? "y" : "x";
}

/**
 * Travel past the top: 1:1 at first, then ever stiffer, never more than
 * `limit`.
 */
export function rubberBand(
  distance: number,
  limit: number = SHEET_OVERDRAG,
): number {
  if (distance <= 0) return 0;
  return (distance * limit) / (distance + limit);
}

/**
 * Where the sheet sits for a finger `delta` px from where the drag started,
 * the sheet then resting at `base`. Down and back up to the top it follows
 * the finger exactly; above the top it resists.
 */
export function dragOffset(base: number, delta: number): number {
  const raw = base + delta;
  return raw >= 0 ? raw : -rubberBand(-raw);
}

export interface SheetSample {
  /** ms */
  t: number;
  /** offset, px */
  y: number;
}

/**
 * The sheet's speed at release (px/ms, positive downward), from the samples
 * inside the velocity window. A finger that came to rest before letting go
 * leaves fewer than two samples there and so no speed.
 */
export function releaseVelocity(
  samples: readonly SheetSample[],
  now: number,
  window: number = SHEET_VELOCITY_WINDOW,
): number {
  let first: SheetSample | null = null;
  let last: SheetSample | null = null;
  for (const sample of samples) {
    if (now - sample.t > window) continue;
    if (first === null) first = sample;
    last = sample;
  }
  if (first === null || last === null || last.t <= first.t) return 0;
  return (last.y - first.y) / (last.t - first.t);
}

export interface SheetSettleInput {
  offset: number;
  velocity: number;
  /** The sheet's own height, px. */
  height: number;
  /** The preview step's resting offset; null for a sheet without one. */
  previewOffset: number | null;
}

/**
 * Where a released sheet goes.
 *
 *   - Further than a quarter of its visible height below its lowest resting
 *     place: it closes.
 *   - Flicked down: it closes once it is below that resting place, otherwise
 *     it drops to the preview step (or back to the top without one).
 *   - Flicked up: it rises to the top.
 *   - Otherwise it goes to the nearer resting place.
 */
export function settleSheet({
  offset,
  velocity,
  height,
  previewOffset,
}: SheetSettleInput): SheetSettle {
  const lowest = previewOffset ?? 0;
  const visible = Math.max(height - lowest, 1);
  if (offset - lowest > SHEET_DISMISS_RATIO * visible) return { kind: "close" };
  if (velocity > SHEET_FLICK_VELOCITY) {
    if (offset > lowest) return { kind: "close" };
    return { kind: "snap", snap: previewOffset === null ? "full" : "preview" };
  }
  if (velocity < -SHEET_FLICK_VELOCITY || previewOffset === null) {
    return { kind: "snap", snap: "full" };
  }
  return {
    kind: "snap",
    snap: offset < previewOffset / 2 ? "full" : "preview",
  };
}

/**
 * The backdrop's opacity: whole while the sheet is at or above its lowest
 * resting place, fading in step with the sheet on its way out.
 */
export function backdropOpacity(
  offset: number,
  lowest: number,
  height: number,
): number {
  const travel = Math.max(height - lowest, 1);
  const out = (offset - lowest) / travel;
  return Math.min(1, Math.max(0, 1 - out));
}

/**
 * How far a preview sheet's footer is lifted against the sheet's own
 * offset, so it stays on the bottom edge of the window between the preview
 * step and the top, and leaves with the sheet below the preview step.
 */
export function footerLift(offset: number, previewOffset: number): number {
  return Math.min(Math.max(offset, 0), previewOffset);
}

/**
 * Whether a vertical touch that began inside scrolling content moves the
 * sheet. Content that is scrolled at all scrolls first; at the very top a
 * downward pull moves the sheet, and an upward one only raises a sheet that
 * is still on its preview step (otherwise it scrolls the content).
 */
export function contentDrags({
  scrollTop,
  dy,
  snap,
  hasPreview,
}: {
  scrollTop: number;
  dy: number;
  snap: SheetSnap;
  hasPreview: boolean;
}): boolean {
  if (scrollTop > 0) return false;
  if (dy > 0) return true;
  return hasPreview && snap === "preview";
}

/** The `translateY` of a computed `transform` value (`none`, `matrix()` or `matrix3d()`). */
export function translateYOf(transform: string): number {
  if (!transform || transform === "none") return 0;
  const values = transform
    .slice(transform.indexOf("(") + 1, transform.lastIndexOf(")"))
    .split(",")
    .map((part) => Number.parseFloat(part));
  if (transform.startsWith("matrix3d(")) return values[13] ?? 0;
  if (transform.startsWith("matrix(")) return values[5] ?? 0;
  return 0;
}
