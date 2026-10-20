/**
 * v1.18.1 — Rest Mode resolver.
 *
 * Rest Mode ANNOTATES, never penalises. These tests pin the resolver
 * contract: module-gated (a disabled / opted-out account is never in Rest
 * Mode and does no episode read), the fold to the renderable context, and the
 * fail-soft behaviour (a read error reads as "not in Rest Mode" so a Rest Mode
 * annotation can never break the payload it rides on).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gate = vi.hoisted(() => ({ isIllnessEnabled: vi.fn() }));
const db = vi.hoisted(() => ({
  prisma: { illnessEpisode: { findMany: vi.fn() } },
}));

vi.mock("@/lib/illness/gate", () => gate);
vi.mock("@/lib/db", () => db);

import {
  getActiveIllnessEpisodes,
  resolveRestMode,
  toRestModeContext,
  REST_MODE_INACTIVE,
  hasActiveIllnessEpisode,
  triggersRestMode,
} from "@/lib/illness/rest-mode";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActiveIllnessEpisodes", () => {
  it("returns [] without a read when the illness module is disabled", async () => {
    gate.isIllnessEnabled.mockResolvedValue(false);
    await expect(getActiveIllnessEpisodes("u1")).resolves.toEqual([]);
    expect(db.prisma.illnessEpisode.findMany).not.toHaveBeenCalled();
  });

  it("queries only active (unresolved, not-deleted, onset ≤ asOf) episodes when enabled", async () => {
    gate.isIllnessEnabled.mockResolvedValue(true);
    db.prisma.illnessEpisode.findMany.mockResolvedValue([]);
    const asOf = new Date("2026-06-16T00:00:00.000Z");
    await getActiveIllnessEpisodes("u1", asOf);
    const arg = db.prisma.illnessEpisode.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      userId: "u1",
      deletedAt: null,
      resolvedAt: null,
      onsetAt: { lte: asOf },
    });
  });
});

describe("toRestModeContext", () => {
  it("folds an empty set to the inactive context", () => {
    expect(toRestModeContext([])).toEqual(REST_MODE_INACTIVE);
  });

  it("anchors `since` on the earliest onset and counts episodes (no note leaks)", () => {
    const ctx = toRestModeContext([
      {
        id: "e1",
        label: "Erkältung",
        type: "INFECTION",
        lifecycle: "ACUTE",
        onsetAt: new Date("2026-06-10T00:00:00.000Z"),
      },
      {
        id: "e2",
        label: "Heuschnupfen",
        type: "ALLERGY",
        lifecycle: "RECURRING",
        onsetAt: new Date("2026-06-14T00:00:00.000Z"),
      },
    ]);
    expect(ctx.active).toBe(true);
    expect(ctx.episodeCount).toBe(2);
    expect(ctx.since).toBe("2026-06-10T00:00:00.000Z");
    // The context carries labels + lifecycle only — no free-text note field.
    expect(ctx.episodes[0]).not.toHaveProperty("note");
    expect(Object.keys(ctx.episodes[0]).sort()).toEqual([
      "id",
      "label",
      "lifecycle",
      "onsetAt",
      "type",
    ]);
  });
});

describe("resolveRestMode", () => {
  it("resolves active context from the active episodes", async () => {
    gate.isIllnessEnabled.mockResolvedValue(true);
    db.prisma.illnessEpisode.findMany.mockResolvedValue([
      {
        id: "e1",
        label: "Erkältung",
        type: "INFECTION",
        lifecycle: "ACUTE",
        onsetAt: new Date("2026-06-10T00:00:00.000Z"),
      },
    ]);
    const ctx = await resolveRestMode("u1");
    expect(ctx.active).toBe(true);
    expect(ctx.episodeCount).toBe(1);
  });

  it("is fail-soft: a read error reads as not-in-Rest-Mode", async () => {
    gate.isIllnessEnabled.mockResolvedValue(true);
    db.prisma.illnessEpisode.findMany.mockRejectedValue(new Error("boom"));
    await expect(resolveRestMode("u1")).resolves.toEqual(REST_MODE_INACTIVE);
  });

  it("is inactive (no read) for a disabled module", async () => {
    gate.isIllnessEnabled.mockResolvedValue(false);
    await expect(resolveRestMode("u1")).resolves.toEqual(REST_MODE_INACTIVE);
  });
});

/**
 * #1216 — a chronic ongoing condition has no end date by design, so it must
 * never put the account into Rest Mode on its own: Day N would count from an
 * onset years back, nudges would never resume and streaks could never break.
 * Only active episodes that are not CHRONIC_ONGOING trigger it, and Day N
 * counts from the earliest of those.
 */
describe("Rest Mode and chronic conditions (#1216)", () => {
  const chronic = {
    id: "c1",
    label: "Sleep apnoea",
    type: "CHRONIC" as const,
    lifecycle: "CHRONIC_ONGOING" as const,
    onsetAt: new Date("2015-08-01T00:00:00.000Z"),
  };
  const acute = {
    id: "a1",
    label: "Cold",
    type: "INFECTION" as const,
    lifecycle: "ACUTE" as const,
    onsetAt: new Date("2026-06-12T00:00:00.000Z"),
  };
  const flare = {
    id: "f1",
    label: "Flare",
    type: "AUTOIMMUNE" as const,
    lifecycle: "FLARE" as const,
    onsetAt: new Date("2026-06-14T00:00:00.000Z"),
  };

  it("a chronic condition alone is not Rest Mode", () => {
    expect(toRestModeContext([chronic])).toEqual(REST_MODE_INACTIVE);
  });

  it("chronic + acute is Rest Mode, anchored on the acute onset", () => {
    const ctx = toRestModeContext([chronic, acute]);
    expect(ctx.active).toBe(true);
    expect(ctx.since).toBe("2026-06-12T00:00:00.000Z");
    expect(ctx.episodeCount).toBe(1);
    expect(ctx.episodes.map((e) => e.id)).toEqual(["a1"]);
  });

  it("a flare threaded under a chronic condition is Rest Mode", () => {
    const ctx = toRestModeContext([chronic, flare]);
    expect(ctx.active).toBe(true);
    expect(ctx.since).toBe("2026-06-14T00:00:00.000Z");
  });

  it("anchors on the earliest triggering onset whatever the input order", () => {
    expect(toRestModeContext([flare, chronic, acute]).since).toBe(
      "2026-06-12T00:00:00.000Z",
    );
  });

  it("resolveRestMode is inactive for a chronic-only account", async () => {
    gate.isIllnessEnabled.mockResolvedValue(true);
    db.prisma.illnessEpisode.findMany.mockResolvedValue([chronic]);
    await expect(
      resolveRestMode("u1", new Date("2026-06-16T00:00:00.000Z")),
    ).resolves.toEqual(REST_MODE_INACTIVE);
  });

  it("hasActiveIllnessEpisode still sees the chronic condition as context", async () => {
    gate.isIllnessEnabled.mockResolvedValue(true);
    db.prisma.illnessEpisode.findMany.mockResolvedValue([chronic]);
    await expect(
      hasActiveIllnessEpisode("u1", new Date("2026-06-16T00:00:00.000Z")),
    ).resolves.toBe(true);
  });

  it("hasActiveIllnessEpisode is fail-soft", async () => {
    gate.isIllnessEnabled.mockResolvedValue(true);
    db.prisma.illnessEpisode.findMany.mockRejectedValue(new Error("db down"));
    await expect(
      hasActiveIllnessEpisode("u1", new Date("2026-06-17T00:00:00.000Z")),
    ).resolves.toBe(false);
  });

  it("triggersRestMode exempts only CHRONIC_ONGOING", () => {
    expect(
      ["ACUTE", "RECURRING", "FLARE", "CHRONIC_ONGOING"].map((lifecycle) =>
        triggersRestMode({ lifecycle }),
      ),
    ).toEqual([true, true, true, false]);
  });
});
