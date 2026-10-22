import { describe, expect, it } from "vitest";

import {
  SHEET_AXIS_SLOP,
  SHEET_OVERDRAG,
  backdropOpacity,
  contentDrags,
  dragOffset,
  footerLift,
  lockAxis,
  releaseVelocity,
  rubberBand,
  settleSheet,
  translateYOf,
} from "../sheet-gesture";

describe("lockAxis", () => {
  it("waits inside the slop", () => {
    expect(lockAxis(0, 0)).toBeNull();
    expect(lockAxis(SHEET_AXIS_SLOP - 1, -(SHEET_AXIS_SLOP - 1))).toBeNull();
  });

  it("reads vertical and sideways once past it", () => {
    expect(lockAxis(2, SHEET_AXIS_SLOP)).toBe("y");
    expect(lockAxis(2, -20)).toBe("y");
    expect(lockAxis(SHEET_AXIS_SLOP, 3)).toBe("x");
    expect(lockAxis(-30, 12)).toBe("x");
  });

  it("gives a diagonal tie to the sideways gesture", () => {
    expect(lockAxis(12, 12)).toBe("x");
    expect(lockAxis(-12, 12)).toBe("x");
  });
});

describe("rubberBand / dragOffset", () => {
  it("follows the finger 1:1 below the top", () => {
    expect(dragOffset(0, 120)).toBe(120);
    expect(dragOffset(300, -200)).toBe(100);
    expect(dragOffset(300, -300)).toBe(0);
  });

  it("resists above the top and never passes the limit", () => {
    const small = -dragOffset(0, -4);
    expect(small).toBeGreaterThan(3);
    expect(small).toBeLessThan(4);
    const far = -dragOffset(0, -2000);
    expect(far).toBeLessThan(SHEET_OVERDRAG);
    expect(far).toBeGreaterThan(SHEET_OVERDRAG * 0.95);
    // From a lowered resting place the resistance starts at the top only.
    expect(dragOffset(300, -350)).toBeCloseTo(-rubberBand(50), 6);
  });

  it("is monotonic", () => {
    let previous = Infinity;
    for (let d = 0; d <= 500; d += 25) {
      const y = dragOffset(0, -d);
      expect(y).toBeLessThanOrEqual(previous);
      previous = y;
    }
  });

  it("has no travel for no distance", () => {
    expect(rubberBand(0)).toBe(0);
    expect(rubberBand(-5)).toBe(0);
  });
});

describe("releaseVelocity", () => {
  it("measures px/ms over the samples inside the window", () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 50, y: 10 },
      { t: 100, y: 60 },
      { t: 150, y: 110 },
    ];
    // Window 100 ms before t=150 keeps t=50..150: (110-10)/100.
    expect(releaseVelocity(samples, 150)).toBeCloseTo(1, 6);
  });

  it("is zero when the finger rested before letting go", () => {
    const samples = [
      { t: 0, y: 0 },
      { t: 40, y: 200 },
    ];
    expect(releaseVelocity(samples, 400)).toBe(0);
  });

  it("is zero with a single sample", () => {
    expect(releaseVelocity([{ t: 10, y: 5 }], 20)).toBe(0);
    expect(releaseVelocity([], 20)).toBe(0);
  });

  it("is negative for an upward flick", () => {
    const samples = [
      { t: 0, y: 100 },
      { t: 40, y: 20 },
    ];
    expect(releaseVelocity(samples, 40)).toBeCloseTo(-2, 6);
  });
});

describe("settleSheet without a preview step", () => {
  const base = { height: 400, previewOffset: null };

  it("closes past a quarter of the height", () => {
    expect(settleSheet({ ...base, offset: 101, velocity: 0 })).toEqual({
      kind: "close",
    });
  });

  it("springs back short of it", () => {
    expect(settleSheet({ ...base, offset: 99, velocity: 0 })).toEqual({
      kind: "snap",
      snap: "full",
    });
  });

  it("closes on a flick down faster than 0.5 px/ms", () => {
    expect(settleSheet({ ...base, offset: 30, velocity: 0.6 })).toEqual({
      kind: "close",
    });
    expect(settleSheet({ ...base, offset: 30, velocity: 0.5 })).toEqual({
      kind: "snap",
      snap: "full",
    });
  });

  it("does not close on a flick down from above the top", () => {
    expect(settleSheet({ ...base, offset: -10, velocity: 2 })).toEqual({
      kind: "snap",
      snap: "full",
    });
  });
});

describe("settleSheet with a preview step", () => {
  // 800 px tall, the preview shows 450: resting offset 350.
  const base = { height: 800, previewOffset: 350 };

  it("closes a quarter of the visible preview below it", () => {
    expect(settleSheet({ ...base, offset: 350 + 113, velocity: 0 })).toEqual({
      kind: "close",
    });
    expect(settleSheet({ ...base, offset: 350 + 112, velocity: 0 })).toEqual({
      kind: "snap",
      snap: "preview",
    });
  });

  it("goes to the nearer step on a slow release", () => {
    expect(settleSheet({ ...base, offset: 100, velocity: 0 })).toEqual({
      kind: "snap",
      snap: "full",
    });
    expect(settleSheet({ ...base, offset: 250, velocity: 0 })).toEqual({
      kind: "snap",
      snap: "preview",
    });
  });

  it("rises to the top on a flick up", () => {
    expect(settleSheet({ ...base, offset: 330, velocity: -0.8 })).toEqual({
      kind: "snap",
      snap: "full",
    });
  });

  it("drops a full sheet to the preview step on a flick down, and closes below it", () => {
    expect(settleSheet({ ...base, offset: 60, velocity: 1.2 })).toEqual({
      kind: "snap",
      snap: "preview",
    });
    expect(settleSheet({ ...base, offset: 360, velocity: 1.2 })).toEqual({
      kind: "close",
    });
  });
});

describe("backdropOpacity", () => {
  it("is whole at and above the lowest resting place", () => {
    expect(backdropOpacity(0, 0, 400)).toBe(1);
    expect(backdropOpacity(-20, 0, 400)).toBe(1);
    expect(backdropOpacity(100, 300, 800)).toBe(1);
  });

  it("fades in proportion to the way out", () => {
    expect(backdropOpacity(200, 0, 400)).toBeCloseTo(0.5, 6);
    expect(backdropOpacity(300 + 250, 300, 800)).toBeCloseTo(0.5, 6);
    expect(backdropOpacity(900, 0, 400)).toBe(0);
  });
});

describe("footerLift", () => {
  it("holds the footer on the window edge between the steps", () => {
    expect(footerLift(0, 350)).toBe(0);
    expect(footerLift(200, 350)).toBe(200);
    expect(footerLift(350, 350)).toBe(350);
  });

  it("lets it leave with the sheet below the preview step", () => {
    expect(footerLift(500, 350)).toBe(350);
    expect(footerLift(-10, 350)).toBe(0);
  });
});

describe("contentDrags", () => {
  const top = { scrollTop: 0, hasPreview: false, snap: "full" as const };

  it("scrolls first when the content is scrolled", () => {
    expect(contentDrags({ ...top, scrollTop: 1, dy: 30 })).toBe(false);
    expect(contentDrags({ ...top, scrollTop: 120, dy: -30 })).toBe(false);
  });

  it("drags down from the very top", () => {
    expect(contentDrags({ ...top, dy: 30 })).toBe(true);
  });

  it("lets an upward swipe scroll, unless it raises a preview sheet", () => {
    expect(contentDrags({ ...top, dy: -30 })).toBe(false);
    expect(
      contentDrags({ ...top, hasPreview: true, snap: "full", dy: -30 }),
    ).toBe(false);
    expect(
      contentDrags({ ...top, hasPreview: true, snap: "preview", dy: -30 }),
    ).toBe(true);
  });
});

describe("translateYOf", () => {
  it("reads 2D and 3D matrices", () => {
    expect(translateYOf("none")).toBe(0);
    expect(translateYOf("")).toBe(0);
    expect(translateYOf("matrix(1, 0, 0, 1, 0, 123.5)")).toBe(123.5);
    expect(
      translateYOf("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -7, 0, 1)"),
    ).toBe(-7);
  });
});
