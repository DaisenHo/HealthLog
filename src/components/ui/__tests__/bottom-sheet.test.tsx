import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

/**
 * The bottom sheet's anatomy, rendered statically: the grip, the 44 px X on
 * the title row, the preview step's wiring, and that every bottom sheet
 * (`<SheetContent side="bottom">`) takes this path while the other sides do
 * not. Radix portals do not render on the server, so its Dialog parts are
 * passed through as plain elements; what Radix itself does (focus, Escape,
 * the backdrop) and the drag in a browser are `e2e/bottom-sheet.spec.ts`.
 */

vi.mock("@/lib/i18n/context", () => ({
  useTranslations: () => ({ t: (key: string) => key }),
}));

vi.mock("radix-ui", () => {
  type P = { children?: ReactNode; [key: string]: unknown };
  const strip = ({ asChild: _asChild, ...rest }: P) => rest;
  return {
    Dialog: {
      Root: ({ children }: P) => <>{children}</>,
      Portal: ({ children }: P) => <>{children}</>,
      Overlay: (props: P) => <div data-mock="overlay" {...strip(props)} />,
      Content: ({ children, ...props }: P) => (
        <div role="dialog" {...strip(props)}>
          {children}
        </div>
      ),
      Close: ({ children, ...props }: P) => (
        <button type="button" {...strip(props)}>
          {children}
        </button>
      ),
      Title: ({ children }: P) => <h2>{children}</h2>,
      Description: ({ children }: P) => <p>{children}</p>,
      Trigger: ({ children }: P) => <>{children}</>,
    },
  };
});

const { BottomSheetContent, BOTTOM_SHEET_CLASS } =
  await import("../bottom-sheet");
const { SheetContent } = await import("../sheet");

function attr(html: string, slot: string): string {
  const match = new RegExp(`<[^>]*data-slot="${slot}"[^>]*>`).exec(html);
  return match?.[0] ?? "";
}

describe("<BottomSheetContent>", () => {
  it("draws a decorative grip and a 44 px X on the title row", () => {
    const html = renderToStaticMarkup(
      <BottomSheetContent>body</BottomSheetContent>,
    );
    const grip = attr(html, "sheet-grip");
    expect(grip).toContain('aria-hidden="true"');
    expect(grip).toContain("h-6");
    expect(grip).toContain("touch-none");
    expect(html).toContain("h-1.25 w-9 rounded-full");
    const close = attr(html, "sheet-close-button");
    expect(close).toContain("size-11");
    expect(close).toContain("top-7.5");
    expect(html).toContain("common.close");
    // The swipe closes through a Radix Close of its own, out of reach.
    const swipe = attr(html, "sheet-swipe-close");
    expect(swipe).toContain("hidden");
    expect(swipe).toContain('tabindex="-1"');
  });

  it("keeps its backdrop out of touch panning", () => {
    const html = renderToStaticMarkup(
      <BottomSheetContent>body</BottomSheetContent>,
    );
    expect(attr(html, "sheet-overlay")).toContain("touch-none");
    expect(attr(html, "sheet-overlay")).toContain(
      "motion-reduce:animate-none!",
    );
  });

  it("drops the grip, the drag and the X offset when it is not draggable", () => {
    const html = renderToStaticMarkup(
      <BottomSheetContent draggable={false}>body</BottomSheetContent>,
    );
    expect(html).not.toContain('data-slot="sheet-grip"');
    expect(html).not.toContain('data-slot="sheet-swipe-close"');
    expect(attr(html, "sheet-close-button")).toContain("top-3");
  });

  it("opens a preview sheet on its preview step, with a grip that expands it", () => {
    const html = renderToStaticMarkup(
      <BottomSheetContent
        preview="58dvh"
        previewLabels={{ expand: "Expand", shrink: "Shrink" }}
      >
        body
      </BottomSheetContent>,
    );
    const content = attr(html, "sheet-content");
    expect(content).toContain('data-sheet-snap="preview"');
    expect(content).toContain("--sheet-height:90dvh");
    expect(content).toContain("--sheet-preview-height:58dvh");
    expect(content).toContain("h-(--sheet-height)");
    const grip = attr(html, "sheet-grip");
    expect(grip).toMatch(/^<button/);
    expect(grip).toContain('aria-label="Expand"');
    expect(grip).toContain('aria-expanded="false"');
  });

  it("names its side for the keyboard rule and lets a consumer slot win", () => {
    const html = renderToStaticMarkup(
      <BottomSheetContent data-slot="mine" className="bg-card gap-0">
        body
      </BottomSheetContent>,
    );
    expect(html).toContain('data-sheet-side="bottom"');
    expect(html).toContain('data-slot="mine"');
    const content = attr(html, "mine");
    expect(content).toMatch(/\bbg-card\b/);
    expect(content).not.toContain("bg-background");
    expect(content).not.toMatch(/\bgap-4\b/);
  });

  it("moves, opens and closes on its own timing and stays still under reduced motion", () => {
    expect(BOTTOM_SHEET_CLASS).toContain("data-[state=open]:duration-260");
    expect(BOTTOM_SHEET_CLASS).toContain("data-[state=closed]:duration-220");
    expect(BOTTOM_SHEET_CLASS).toContain("ease-out");
    // Important: the data-state animation outranks a plain media variant.
    expect(BOTTOM_SHEET_CLASS).toContain("motion-reduce:animate-none!");
    expect(BOTTOM_SHEET_CLASS).toContain("max-h-[90dvh]");
  });
});

describe("<SheetContent>", () => {
  it("renders every bottom sheet through the bottom sheet", () => {
    const html = renderToStaticMarkup(
      <SheetContent side="bottom">body</SheetContent>,
    );
    expect(html).toContain('data-slot="sheet-grip"');
    expect(html).toContain('data-sheet-side="bottom"');
  });

  it("leaves the side sheets as they were", () => {
    const html = renderToStaticMarkup(
      <SheetContent side="right" preview="58dvh">
        body
      </SheetContent>,
    );
    expect(html).not.toContain('data-slot="sheet-grip"');
    expect(html).not.toContain("data-sheet-snap");
    expect(html).toContain('data-sheet-side="right"');
    expect(attr(html, "sheet-close-button")).toContain("top-3 right-4");
  });
});
