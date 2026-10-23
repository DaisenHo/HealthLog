"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { useTranslations } from "@/lib/i18n/context";
import type { SheetSnap } from "@/lib/sheet-gesture";
import { cn } from "@/lib/utils";

/**
 * The bottom sheet: every `<SheetContent side="bottom">` renders through
 * here, and so does `ResponsiveSheet` on a phone.
 *
 * It is Radix's Dialog with a drag on top. Focus moving in, the focus trap,
 * Escape, the backdrop tap, `role="dialog"` and its name, and the scroll
 * lock on the page behind all stay Radix's. What this adds:
 *
 *   - focus goes back to whatever opened the sheet (Radix only knows a
 *     `Dialog.Trigger`, which most openers are not), unless the caller's
 *     `onCloseAutoFocus` places it itself; and `aria-modal`;
 *   - a grip at the top edge; the grip and the header drag the sheet always,
 *     the content only while it is scrolled to its very top
 *     (`use-sheet-drag.ts`, rules in `lib/sheet-gesture.ts`);
 *   - a release past a quarter of the height, or a flick down, closes it,
 *     anything less springs back; sideways movement never counts;
 *   - the backdrop lightens as the sheet goes down, and neither it nor the
 *     grip and header ever scroll or pull the page behind;
 *   - opt in, a preview step (`preview`): the sheet opens at that height and
 *     a pull up, or a tap on the grip, takes it to the full 90 dvh. Its
 *     footer (`data-sheet-footer`) stays on the window's bottom edge and its
 *     scrolling body (`data-sheet-body`) ends above it on either step.
 *
 * The X sits on the title row, 44 px square; the keyboard and a screen
 * reader close the sheet through it or Escape, never through a gesture.
 */

export interface BottomSheetOptions {
  /**
   * Opens the sheet at this height (a CSS length, e.g. `58dvh`) with the
   * full 90 dvh one pull up. Needs `previewLabels` for the grip, which then
   * becomes a button that toggles the two steps.
   */
  preview?: string;
  previewLabels?: { expand: string; shrink: string };
  /**
   * False leaves out the grip and the drag, for a sheet that fills the whole
   * window (the command palette): there is no backdrop to pull it towards.
   */
  draggable?: boolean;
}

export type BottomSheetContentProps = React.ComponentProps<
  typeof SheetPrimitive.Content
> &
  BottomSheetOptions & { showCloseButton?: boolean };

/**
 * No `bottom-*` here: the sheet's `bottom` comes from the keyboard rule in
 * `globals.css`, which a utility would outrank. In 260 ms, out 220 ms, both
 * easing out; no slide at all under reduced motion. That `animate-none` is
 * important: `data-[state=open]:animate-in` carries an attribute selector and
 * outranks a plain media variant, so without the `!` the slide stayed on,
 * only shortened to 0.01 ms by the global reduced-motion rule, and still
 * existed (and ran) until the next frame was drawn. The `after:` strip
 * continues the sheet's own background below its edge, so the short
 * resisting travel above the top never shows the page underneath.
 */
export const BOTTOM_SHEET_CLASS =
  "bg-background fixed inset-x-0 z-50 flex max-h-[90dvh] flex-col gap-4 border-t shadow-lg transition-transform ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom data-[state=open]:duration-260 data-[state=closed]:duration-220 motion-reduce:animate-none! motion-reduce:transition-none after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-10 after:bg-inherit after:content-['']";

const OVERLAY_CLASS =
  "fixed inset-0 z-50 touch-none bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 ease-out data-[state=open]:duration-260 data-[state=closed]:duration-220 motion-reduce:animate-none!";

/** Puts a preview sheet back on its preview step each time it opens. */
function OnOpen({ run }: { run: () => void }) {
  React.useLayoutEffect(() => {
    run();
    // Once per mount, which is once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function SheetGrip({
  snap,
  labels,
  onToggle,
}: {
  snap: SheetSnap;
  labels?: { expand: string; shrink: string };
  onToggle: () => void;
}) {
  const bar = (
    <span
      aria-hidden="true"
      className="bg-muted-foreground/40 h-1.25 w-9 rounded-full"
    />
  );
  if (labels) {
    return (
      <button
        type="button"
        data-slot="sheet-grip"
        aria-label={snap === "full" ? labels.shrink : labels.expand}
        aria-expanded={snap === "full"}
        onClick={onToggle}
        className="focus-visible:ring-ring/50 mx-auto flex h-6 w-16 shrink-0 touch-none items-center justify-center rounded-full focus-visible:ring-[3px] focus-visible:outline-none"
      >
        {bar}
      </button>
    );
  }
  return (
    <div
      data-slot="sheet-grip"
      aria-hidden="true"
      className="flex h-6 shrink-0 touch-none items-center justify-center"
    >
      {bar}
    </div>
  );
}

export function BottomSheetContent({
  className,
  children,
  showCloseButton = true,
  preview,
  previewLabels,
  draggable = true,
  ref,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onClickCapture,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: BottomSheetContentProps) {
  const { t } = useTranslations();
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const overlayRef = React.useRef<HTMLDivElement | null>(null);
  const probeRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  // What had focus when the sheet opened. Radix hands focus back only to a
  // `Dialog.Trigger`, and most bottom sheets open from a plain button (the
  // More tab, a chart's tooltip), so focus fell to the body on close.
  const openerRef = React.useRef<HTMLElement | null>(null);
  const initial: SheetSnap = preview ? "preview" : "full";
  const [snap, setSnap] = React.useState<SheetSnap>(initial);
  const [node, setNode] = React.useState<HTMLDivElement | null>(null);

  const drag = useSheetDrag({
    enabled: draggable,
    hasPreview: !!preview,
    snap,
    onSnap: setSnap,
    onClose: () => closeRef.current?.click(),
    contentRef,
    overlayRef,
    probeRef,
    node,
  });

  const setContent = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      setNode(node);
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      <SheetPrimitive.Overlay
        ref={overlayRef}
        data-slot="sheet-overlay"
        className={OVERLAY_CLASS}
      />
      <SheetPrimitive.Content
        ref={setContent}
        data-slot="sheet-content"
        // Read by the keyboard rule in `globals.css`: a bottom sheet stands
        // on the on-screen keyboard. Its own attribute rather than
        // `data-slot`, which consumers replace with theirs.
        data-sheet-side="bottom"
        data-sheet-snap={preview ? snap : undefined}
        // Radix makes the page behind inert and traps focus; this says so
        // to assistive technology that reads the attribute rather than the
        // hidden siblings.
        aria-modal="true"
        style={
          preview
            ? ({
                "--sheet-height": "90dvh",
                "--sheet-preview-height": preview,
                ...style,
              } as React.CSSProperties)
            : style
        }
        className={cn(
          BOTTOM_SHEET_CLASS,
          preview && "h-(--sheet-height) max-h-(--sheet-height)",
          className,
        )}
        onPointerDown={(event) => {
          onPointerDown?.(event);
          drag.onPointerDown?.(event);
        }}
        onPointerMove={(event) => {
          onPointerMove?.(event);
          drag.onPointerMove?.(event);
        }}
        onPointerUp={(event) => {
          onPointerUp?.(event);
          drag.onPointerUp?.(event);
        }}
        onPointerCancel={(event) => {
          onPointerCancel?.(event);
          drag.onPointerCancel?.(event);
        }}
        onClickCapture={(event) => {
          drag.onClickCapture?.(event);
          onClickCapture?.(event);
        }}
        onOpenAutoFocus={(event) => {
          const active = document.activeElement;
          openerRef.current =
            active instanceof HTMLElement && active !== document.body
              ? active
              : null;
          onOpenAutoFocus?.(event);
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          const opener = openerRef.current;
          if (event.defaultPrevented || !opener?.isConnected) return;
          event.preventDefault();
          opener.focus({ preventScroll: true });
        }}
        {...props}
      >
        {preview ? (
          <>
            <OnOpen run={() => setSnap(initial)} />
            <div
              ref={probeRef}
              aria-hidden="true"
              className="pointer-events-none invisible absolute top-0 left-0 w-px"
              style={{ height: preview }}
            />
          </>
        ) : null}
        {draggable ? (
          <SheetGrip
            snap={snap}
            labels={preview ? previewLabels : undefined}
            onToggle={() => setSnap(snap === "full" ? "preview" : "full")}
          />
        ) : null}
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            data-slot="sheet-close-button"
            className={cn(
              // On the title row: the grip's 24 px plus the header's 16 px
              // top padding put the title's line centre 52 px down.
              draggable ? "top-7.5" : "top-3",
              "ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 text-muted-foreground hover:bg-accent hover:text-foreground absolute right-2 inline-flex size-11 touch-none items-center justify-center rounded-md transition-colors focus-visible:ring-[3px] focus-visible:outline-none disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            )}
          >
            <XIcon />
            <span className="sr-only">{t("common.close")}</span>
          </SheetPrimitive.Close>
        ) : null}
        {draggable ? (
          // What a swipe presses: the same close as the X, so the sheet's
          // `onOpenChange` hears one kind of close however it was asked.
          <SheetPrimitive.Close
            ref={closeRef}
            hidden
            tabIndex={-1}
            aria-hidden="true"
            data-slot="sheet-swipe-close"
          />
        ) : null}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
