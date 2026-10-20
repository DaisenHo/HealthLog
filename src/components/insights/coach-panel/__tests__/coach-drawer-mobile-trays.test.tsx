import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "@/lib/i18n/context";
import { CoachDrawerBody } from "../coach-drawer-body";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

/**
 * v1.4.20 phase B4 — Coach drawer rail-tray strip.
 *
 * v1.16.1 — the body lost its inline xl+ sources column (the sources
 * rail is tray-only on every viewport, hidden until toggled) and the
 * clinical-decisions disclaimer slot. The history affordance forks by
 * surface: the drawer hands off to the full-page route via
 * `onHistoryClick`; the page passes an inline `historyRail` slot that
 * renders as a left column on lg+ (the strip button collapses to
 * `lg:hidden` there).
 */

function render(node: React.ReactNode, locale: "en" | "de" = "en") {
  return renderToStaticMarkup(
    <I18nProvider initialLocale={locale}>{node}</I18nProvider>,
  );
}

const baseProps = {
  thread: <span>thread</span>,
  composer: <span>composer</span>,
  onHistoryClick: () => undefined,
  onOpenSourcesTray: () => undefined,
};

describe("<CoachDrawerBody> — rail-tray strip", () => {
  it("renders both strip triggers", () => {
    const html = render(<CoachDrawerBody {...baseProps} />);
    expect(html).toMatch(/data-slot="coach-drawer-history-tray-trigger"/);
    expect(html).toMatch(/data-slot="coach-drawer-sources-tray-trigger"/);
  });

  it("keeps both triggers visible on every breakpoint without an inline historyRail", () => {
    // v1.16.1 — the sources rail is tray-only now, so its trigger lost
    // the `xl:hidden` cap; the history trigger stays visible too.
    const html = render(<CoachDrawerBody {...baseProps} />);
    const historyTrigger = html.match(
      /<button[^>]*data-slot="coach-drawer-history-tray-trigger"[^>]*>/,
    );
    expect(historyTrigger).not.toBeNull();
    expect(historyTrigger?.[0]).not.toContain("lg:hidden");

    const sourcesTrigger = html.match(
      /<button[^>]*data-slot="coach-drawer-sources-tray-trigger"[^>]*>/,
    );
    expect(sourcesTrigger).not.toBeNull();
    expect(sourcesTrigger?.[0]).not.toContain("xl:hidden");
  });

  it("no longer mounts an inline sources column", () => {
    const html = render(<CoachDrawerBody {...baseProps} />);
    expect(html).not.toContain('data-slot="coach-drawer-sources"');
  });

  it("mounts a collapsible inline history column on lg+ when historyRail is passed (page surface)", () => {
    // v1.18.7 W-coach C-UI — the inline rail is now collapsible and
    // collapsed by default; the page surface passes `onToggleHistory`.
    // The sub-lg tray trigger keeps `lg:hidden` (the bottom tray covers
    // small viewports); a separate lg+ toggle (`coach-history-toggle`)
    // shows the rail on desktop.
    const html = render(
      <CoachDrawerBody
        {...baseProps}
        historyRail={<span>history</span>}
        onToggleHistory={() => undefined}
      />,
    );
    expect(html).toMatch(
      /<aside[^>]*data-slot="coach-drawer-history"[^>]*lg:flex/,
    );
    expect(html).toContain("history");
    // Sub-lg tray trigger collapses on lg+ (the inline rail covers it).
    const historyTrigger = html.match(
      /<button[^>]*data-slot="coach-drawer-history-tray-trigger"[^>]*>/,
    );
    expect(historyTrigger?.[0]).toContain("lg:hidden");
    // lg+ inline-rail toggle is present and labelled as a show control.
    const railToggle = html.match(
      /<button[^>]*data-slot="coach-history-toggle"[^>]*>/,
    );
    expect(railToggle).not.toBeNull();
    expect(railToggle?.[0]).toContain('aria-expanded="false"');
  });

  it("renders the message thread + composer slots without a disclaimer line", () => {
    const html = render(<CoachDrawerBody {...baseProps} />);
    expect(html).toMatch(/data-slot="coach-drawer-thread"/);
    expect(html).toMatch(/data-slot="coach-drawer-composer"/);
    // Slot content forwarded verbatim.
    expect(html).toContain("thread");
    expect(html).toContain("composer");
    // v1.16.1 — the clinical-decisions disclaimer was removed from the
    // chat UI entirely.
    expect(html).not.toContain("coach-composer-disclaimer");
  });

  it("uses the localized trigger labels — History on the left, Sources on the right", () => {
    const html = render(<CoachDrawerBody {...baseProps} />);
    const historyTrigger = html.match(
      /<button[^>]*data-slot="coach-drawer-history-tray-trigger"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(historyTrigger).not.toBeNull();
    expect(historyTrigger?.[0]).toContain("Conversations");

    const sourcesTrigger = html.match(
      /<button[^>]*data-slot="coach-drawer-sources-tray-trigger"[^>]*>[\s\S]*?<\/button>/,
    );
    expect(sourcesTrigger).not.toBeNull();
    expect(sourcesTrigger?.[0]).toContain("What I can see");
  });

  it("renders the German trigger labels in the de locale", () => {
    const html = render(<CoachDrawerBody {...baseProps} />, "de");
    expect(html).toContain("Unterhaltungen");
    expect(html).toContain("Worauf ich zugreife");
  });

  it("renders the rail triggers in a sub-header strip above the thread", () => {
    // v1.4.27 R3d MB2 — the triggers were lifted out of the absolute
    // overlay into a sub-header strip so they sit at a 44 px tap
    // target and never overlay the first message bubble.
    const html = render(<CoachDrawerBody {...baseProps} />);
    expect(html).toMatch(/data-slot="coach-drawer-rail-tray-strip"/);
    const trigger = html.match(
      /<button[^>]*data-slot="coach-drawer-history-tray-trigger"[^>]*>/,
    );
    expect(trigger?.[0]).toContain("min-h-11");
  });
});
