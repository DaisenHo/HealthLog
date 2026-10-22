import type { Locator, Page } from "@playwright/test";

import { mockDay } from "./setup/day-mock";
import { expect, test } from "./setup/test";
import { MOBILE_ROUTES_STORAGE_STATE_PATH } from "./setup/global-setup";

/**
 * The bottom sheet's drag on WebKit with an iPhone profile (the
 * `webkit-iphone` project), against the three kinds of bottom sheet the app
 * has: the More sheet (a plain `<Sheet side="bottom">`), the day sheet (the
 * preview step) and a capture form (`ResponsiveSheet` on a phone).
 *
 * Playwright can tap on WebKit but not move a touch, so a drag is dispatched
 * through the page as the browser would deliver it: `pointerdown` /
 * `pointermove` / `pointerup` with `pointerType: "touch"` and the matching
 * `touchstart` / `touchmove` / `touchend`, on the element under the finger,
 * paced in real time so the release speed is real. Nothing calls into the
 * sheet's own code. What synthetic events cannot do is scroll natively, so
 * "content scrolls first" is proven as "a scrolled body does not move the
 * sheet", with the scroll position set the way a scroll would leave it.
 *
 * Stable hooks only: `bottom-nav-more` / `bottom-nav-more-sheet`,
 * `day-panel` with `data-sheet-snap`, `day-body`, `day-footer`,
 * `sheet-grip`, `sheet-close-button`, `sheet-overlay`, `capture-picker-*`.
 */

interface Drag {
  dx?: number;
  dy: number;
  /** Duration of the movement, ms. */
  ms: number;
  steps?: number;
  /** Rest before lifting the finger, ms (a slow, deliberate release). */
  holdMs?: number;
  /**
   * After the rest, keep the finger down until the page has rendered this
   * many frames. The sheet writes its position once per animation frame, and
   * WebKit in the CI container can go a second or more without rendering a
   * frame while timers and events run on (the trace shows the More sheet
   * still sliding in 1.5 s after its animation reported finished). A check
   * on where the sheet was drawn needs those frames; a check on where it
   * ends up does not, because the release is decided from the touch alone.
   */
  holdFrames?: number;
}

/** A touch drag from (x, y), dispatched as WebKit delivers one. */
async function touchDrag(page: Page, x: number, y: number, drag: Drag) {
  await page.evaluate(
    async ({ x, y, dx, dy, ms, steps, holdMs, holdFrames }) => {
      const target = document.elementFromPoint(x, y);
      if (!target) throw new Error(`nothing under ${x},${y}`);
      const id = 11;
      const touchAt = (cx: number, cy: number) => {
        const init = {
          identifier: id,
          target,
          clientX: cx,
          clientY: cy,
          pageX: cx,
          pageY: cy,
          screenX: cx,
          screenY: cy,
          radiusX: 4,
          radiusY: 4,
          force: 1,
        };
        try {
          return new Touch(init);
        } catch {
          return init as unknown as Touch;
        }
      };
      const touchEvent = (type: string, cx: number, cy: number) => {
        const touch = touchAt(cx, cy);
        const touches = type === "touchend" ? [] : [touch];
        try {
          return new TouchEvent(type, {
            touches,
            targetTouches: touches,
            changedTouches: [touch],
            bubbles: true,
            cancelable: true,
            composed: true,
          });
        } catch {
          const event = new Event(type, {
            bubbles: true,
            cancelable: true,
            composed: true,
          });
          Object.defineProperty(event, "touches", { value: touches });
          Object.defineProperty(event, "targetTouches", { value: touches });
          Object.defineProperty(event, "changedTouches", { value: [touch] });
          return event;
        }
      };
      const fire = (
        pointer: "pointerdown" | "pointermove" | "pointerup",
        cx: number,
        cy: number,
      ) => {
        target.dispatchEvent(
          new PointerEvent(pointer, {
            pointerId: id,
            pointerType: "touch",
            isPrimary: true,
            clientX: cx,
            clientY: cy,
            buttons: pointer === "pointerup" ? 0 : 1,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
        const touch = {
          pointerdown: "touchstart",
          pointermove: "touchmove",
          pointerup: "touchend",
        }[pointer];
        target.dispatchEvent(touchEvent(touch, cx, cy));
      };
      const wait = (t: number) => new Promise((r) => setTimeout(r, t));
      fire("pointerdown", x, y);
      for (let i = 1; i <= steps; i += 1) {
        await wait(ms / steps);
        fire("pointermove", x + (dx * i) / steps, y + (dy * i) / steps);
      }
      if (holdMs) await wait(holdMs);
      for (let i = 0; i < holdFrames; i += 1) {
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      fire("pointerup", x + dx, y + dy);
    },
    {
      x,
      y,
      dx: drag.dx ?? 0,
      dy: drag.dy,
      ms: drag.ms,
      steps: drag.steps ?? Math.max(4, Math.round(drag.ms / 16)),
      holdMs: drag.holdMs ?? 0,
      holdFrames: drag.holdFrames ?? 0,
    },
  );
}

/**
 * The browser's pointer capture for a dispatched pointer. A real touch is
 * captured by the browser; a dispatched one is not, and Radix's slider only
 * follows a pointer it holds. This gives it the same bookkeeping, nothing
 * more: events still go to the element they are dispatched on.
 */
async function emulateCapture(page: Page) {
  await page.addInitScript(() => {
    const held = new WeakMap<Element, Set<number>>();
    Element.prototype.setPointerCapture = function (id: number) {
      const set = held.get(this) ?? new Set<number>();
      set.add(id);
      held.set(this, set);
    };
    Element.prototype.hasPointerCapture = function (id: number) {
      return held.get(this)?.has(id) ?? false;
    };
    Element.prototype.releasePointerCapture = function (id: number) {
      held.get(this)?.delete(id);
    };
  });
}

async function centre(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("not on screen");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function topOf(locator: Locator) {
  return (await locator.boundingBox())?.y ?? NaN;
}

/** Waits for the sheet to come to rest (open slide or settle finished). */
async function settled(locator: Locator) {
  await expect
    .poll(() =>
      locator.evaluate((el) =>
        el.getAnimations().every((a) => a.playState !== "running"),
      ),
    )
    .toBe(true);
  // A finished animation is not a drawn one: WebKit can report the slide
  // done while it has not rendered a frame of it yet. Two frames, then rest.
  await locator
    .page()
    .evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  await locator.page().waitForTimeout(300);
}

const more = (page: Page) =>
  page.locator('[data-testid="bottom-nav-more-sheet"]');

async function openMore(page: Page) {
  await page.locator('[data-testid="bottom-nav-more"]').tap();
  await expect(more(page)).toBeVisible();
  await settled(more(page));
}

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

test.describe("the bottom sheet", () => {
  test.use({ storageState: MOBILE_ROUTES_STORAGE_STATE_PATH });

  test.beforeEach(async ({ page, context }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL ?? "http://localhost:3000";
    await context.addCookies([
      { name: "healthlog-locale", value: "en", url: baseURL },
    ]);
    await mockDay(page);
  });

  test("a slow drag past a quarter of its height closes it", async ({
    page,
  }) => {
    await page.goto("/mood");
    await openMore(page);
    const title = more(page).getByRole("heading").first();
    const { x, y } = await centre(title);
    const { box } = await centre(more(page));
    await touchDrag(page, x, y, {
      dy: box.height * 0.4,
      ms: 700,
      holdMs: 160,
    });
    await expect(more(page)).toHaveCount(0);
  });

  test("a short drag springs back", async ({ page }) => {
    await page.goto("/mood");
    await openMore(page);
    await expect(more(page)).toBeVisible();
    const before = await topOf(more(page));
    const { x, y } = await centre(more(page).getByRole("heading").first());
    // Dragging: the sheet follows the finger and the backdrop lightens. A
    // frame loop records the furthest the sheet travelled and the lightest
    // the backdrop got for the whole gesture, so a slow runner cannot make
    // a single fixed-time sample land before the drag has begun.
    await page.evaluate(() => {
      const w = window as unknown as {
        __sheetDrag?: { moved: number; opacity: number; on: boolean };
      };
      w.__sheetDrag = { moved: 0, opacity: 1, on: true };
      const tick = () => {
        const rec = w.__sheetDrag!;
        if (!rec.on) return;
        const sheet = document.querySelector(
          '[data-testid="bottom-nav-more-sheet"]',
        ) as HTMLElement | null;
        const overlay = document.querySelector(
          '[data-slot="sheet-overlay"]',
        ) as HTMLElement | null;
        if (sheet) {
          const moved = new DOMMatrix(getComputedStyle(sheet).transform).f;
          rec.moved = Math.max(rec.moved, moved);
        }
        if (overlay) {
          rec.opacity = Math.min(
            rec.opacity,
            Number(getComputedStyle(overlay).opacity),
          );
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // Two rendered frames with the finger still down: the first paints the
    // sheet where the finger is, the second lets the recorder read it.
    await touchDrag(page, x, y, {
      dy: 60,
      ms: 300,
      holdMs: 200,
      holdFrames: 2,
    });
    const seen = await page.evaluate(() => {
      const w = window as unknown as {
        __sheetDrag: { moved: number; opacity: number; on: boolean };
      };
      w.__sheetDrag.on = false;
      return { moved: w.__sheetDrag.moved, opacity: w.__sheetDrag.opacity };
    });
    expect(seen.moved).toBeGreaterThan(40);
    expect(seen.opacity).toBeLessThan(1);
    await settled(more(page));
    await expect(more(page)).toBeVisible();
    expect(Math.abs((await topOf(more(page))) - before)).toBeLessThan(1);
  });

  test("a fast flick closes it", async ({ page }) => {
    await page.goto("/mood");
    await openMore(page);
    const { x, y } = await centre(more(page).getByRole("heading").first());
    const { box } = await centre(more(page));
    // Well short of a quarter of the height, but fast.
    await touchDrag(page, x, y, {
      dy: Math.min(70, box.height * 0.2),
      ms: 40,
      steps: 4,
    });
    await expect(more(page)).toHaveCount(0);
  });

  test("the backdrop, the X and Escape close it; focus goes back to the trigger", async ({
    page,
  }) => {
    await page.goto("/mood");
    const trigger = page.locator('[data-testid="bottom-nav-more"]');

    await openMore(page);
    await page.touchscreen.tap(195, 40);
    await expect(more(page)).toHaveCount(0);

    await openMore(page);
    const close = more(page).locator('[data-slot="sheet-close-button"]');
    const closeBox = (await close.boundingBox())!;
    expect(closeBox.width).toBeGreaterThanOrEqual(44);
    expect(closeBox.height).toBeGreaterThanOrEqual(44);
    await close.tap();
    await expect(more(page)).toHaveCount(0);

    // The keyboard path: open from the focused trigger, close with Escape.
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(more(page)).toBeVisible();
    await expect(more(page)).toHaveAttribute("role", "dialog");
    await expect(more(page)).toHaveAttribute("aria-modal", "true");
    await expect(more(page)).toHaveAccessibleName(/more/i);
    await expect
      .poll(() =>
        more(page).evaluate((el) => el.contains(document.activeElement)),
      )
      .toBe(true);
    // Tab stays inside.
    for (let i = 0; i < 14; i += 1) await page.keyboard.press("Tab");
    expect(
      await more(page).evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(more(page)).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("the page behind keeps its scroll position and is never pulled to refresh", async ({
    page,
  }) => {
    await page.goto("/");
    const main = page.locator("#main-content");
    await expect(main).toBeVisible();
    await page.waitForTimeout(800);

    // Watch for the refresh disc for the rest of the test.
    await page.evaluate(() => {
      (window as unknown as { ptrSeen: number }).ptrSeen = 0;
      new MutationObserver(() => {
        if (document.querySelector('[data-slot="pull-to-refresh-indicator"]')) {
          (window as unknown as { ptrSeen: number }).ptrSeen += 1;
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    const ptrSeen = () =>
      page.evaluate(() => (window as unknown as { ptrSeen: number }).ptrSeen);

    // The control: the same pull on the page itself does arm the disc, so
    // the watch above can see it (short of the refresh threshold).
    await touchDrag(page, 195, 320, { dy: 90, ms: 400, holdMs: 120 });
    await expect.poll(ptrSeen).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      (window as unknown as { ptrSeen: number }).ptrSeen = 0;
    });

    // A pull on the sheet, short (it springs back) and long (it closes),
    // from the dashboard at the top: the page behind never takes it.
    await openMore(page);
    const { x, y } = await centre(more(page).getByRole("heading").first());
    await touchDrag(page, x, y, { dy: 60, ms: 400, holdMs: 150 });
    await settled(more(page));
    const { box } = await centre(more(page));
    await touchDrag(page, x, y, { dy: box.height * 0.5, ms: 600, holdMs: 150 });
    await expect(more(page)).toHaveCount(0);
    expect(await ptrSeen()).toBe(0);

    // Scrolled down, the page is where it was after the sheet has gone.
    await main.evaluate((el) => el.scrollTo({ top: 400 }));
    const before = await main.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(0);
    await openMore(page);
    const at = await centre(more(page).getByRole("heading").first());
    const sheetBox = (await more(page).boundingBox())!;
    await touchDrag(page, at.x, at.y, {
      dy: sheetBox.height * 0.5,
      ms: 600,
      holdMs: 150,
    });
    await expect(more(page)).toHaveCount(0);
    expect(await main.evaluate((el) => el.scrollTop)).toBe(before);
    expect(await ptrSeen()).toBe(0);
  });

  test("the day opens on its preview step, rises on a pull up, and its content scrolls before it drags", async ({
    page,
  }) => {
    // A short window, so the day's content is longer than its sheet on
    // both steps and the body really scrolls.
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(`/mood?day=${isoDaysAgo(3)}`);
    const panel = page.locator('[data-slot="day-panel"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-shell", "bottom");
    await expect(panel).toHaveAttribute("data-sheet-snap", "preview");
    await settled(panel);
    const viewport = page.viewportSize()!;

    // On the preview step the footer stands on the window's bottom edge.
    const footer = panel.locator('[data-slot="day-footer"]');
    const footerBox = (await footer.boundingBox())!;
    expect(
      Math.abs(footerBox.y + footerBox.height - viewport.height),
    ).toBeLessThan(2);

    // A pull up on the content raises it to the full 90 dvh.
    const body = panel.locator('[data-slot="day-body"]');
    const b = await centre(body);
    await touchDrag(page, b.x, b.y, { dy: -180, ms: 500, holdMs: 150 });
    await expect(panel).toHaveAttribute("data-sheet-snap", "full");
    await settled(panel);
    expect(await topOf(panel)).toBeCloseTo(viewport.height * 0.1, -1);

    // Scrolled content: a pull down scrolls (the browser's), the sheet stays.
    const scrollable = await body.evaluate(
      (el) => el.scrollHeight > el.clientHeight,
    );
    expect(scrollable).toBe(true);
    await body.evaluate((el) => el.scrollTo({ top: 60 }));
    const top = await topOf(panel);
    const inner = await centre(body);
    await touchDrag(page, inner.x, inner.y, {
      dy: 260,
      ms: 500,
      holdMs: 150,
    });
    await settled(panel);
    await expect(panel).toHaveAttribute("data-sheet-snap", "full");
    expect(Math.abs((await topOf(panel)) - top)).toBeLessThan(1);

    // At its very top the same pull drags the sheet: down to the preview
    // step, and from there out.
    await body.evaluate((el) => el.scrollTo({ top: 0 }));
    await touchDrag(page, inner.x, inner.y - 60, {
      dy: 150,
      ms: 500,
      holdMs: 150,
    });
    await expect(panel).toHaveAttribute("data-sheet-snap", "preview");
    await settled(panel);
    const grip = panel.locator('[data-slot="sheet-grip"]');
    const g = await centre(grip);
    await touchDrag(page, g.x, g.y, { dy: 300, ms: 600, holdMs: 150 });
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/mood$/);
  });

  test("the grip is a button that switches the day's two heights", async ({
    page,
  }) => {
    await page.goto(`/mood?day=${isoDaysAgo(3)}`);
    const panel = page.locator('[data-slot="day-panel"]');
    await expect(panel).toHaveAttribute("data-sheet-snap", "preview");
    const grip = panel.locator('[data-slot="sheet-grip"]');
    await expect(grip).toHaveAttribute("aria-expanded", "false");
    await grip.tap();
    await expect(panel).toHaveAttribute("data-sheet-snap", "full");
    await expect(grip).toHaveAttribute("aria-expanded", "true");
  });

  test("a slider inside a sheet moves sideways and the sheet stays", async ({
    page,
  }) => {
    await emulateCapture(page);
    await page.goto("/mood");
    await page.locator('[data-testid="bottom-nav-capture"]').tap();
    await page.locator('[data-testid="capture-picker-symptom"]').tap();
    const form = page.locator(
      '[data-slot="responsive-sheet-content"][data-state="open"]',
    );
    await expect(form).toBeVisible();
    await settled(form);
    const slider = form.locator('[data-slot="slider"]').first();
    await slider.scrollIntoViewIfNeeded();
    await settled(form);
    const top = await topOf(form);
    const s = await centre(slider);
    const thumb = form.locator('[role="slider"]').first();
    const valueOf = async () =>
      (await thumb.count()) ? thumb.getAttribute("aria-valuenow") : null;
    const before = await valueOf();
    // A sideways drag with a little vertical wobble, across the track.
    await touchDrag(page, s.box.x + 8, s.y, {
      dx: s.box.width * 0.7,
      dy: 6,
      ms: 400,
    });
    await expect.poll(valueOf).not.toBe(before);
    await settled(form);
    await expect(form).toBeVisible();
    expect(Math.abs((await topOf(form)) - top)).toBeLessThan(1);
  });

  test("under reduced motion it opens without a slide", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/mood");
    await expect(page.locator('[data-testid="bottom-nav-more"]')).toBeVisible();
    // Read the sheet the moment it is inserted, before the browser has drawn
    // a frame of it: that is when a slide that exists at all is still
    // running, however short it was made. A read after it shows depends on
    // frames having been drawn in between, which WebKit in the CI container
    // does not promise, so a later read alone can pass or fail at random.
    await page.evaluate(() => {
      const w = window as unknown as { __sheetAtInsert?: unknown };
      const watch = new MutationObserver(() => {
        const sheet = document.querySelector(
          '[data-testid="bottom-nav-more-sheet"]',
        );
        const overlay = document.querySelector('[data-slot="sheet-overlay"]');
        if (!sheet || !overlay || w.__sheetAtInsert) return;
        watch.disconnect();
        w.__sheetAtInsert = [sheet, overlay].map((el) => ({
          name: getComputedStyle(el).animationName,
          animations: el.getAnimations().length,
        }));
      });
      watch.observe(document.body, { childList: true, subtree: true });
    });
    await page.locator('[data-testid="bottom-nav-more"]').tap();
    await expect(more(page)).toBeVisible();
    const atInsert = await page.evaluate(
      () =>
        (window as unknown as { __sheetAtInsert?: unknown }).__sheetAtInsert,
    );
    expect(atInsert).toEqual([
      { name: "none", animations: 0 },
      { name: "none", animations: 0 },
    ]);
  });
});
