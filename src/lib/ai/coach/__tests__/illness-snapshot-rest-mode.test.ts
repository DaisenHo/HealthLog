/**
 * #1216 — the Coach illness block (which also answers the MCP
 * `get_illness_recovery` tool) keeps every active condition as context, but
 * its `restMode` flag follows Rest Mode: a chronic ongoing condition alone
 * leaves it false, an acute episode or a flare on top sets it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({
  prisma: {
    illnessEpisode: { findMany },
    symptomEvent: { groupBy: async () => [] },
  },
}));
vi.mock("@/lib/illness/gate", () => ({
  isIllnessEnabled: vi.fn(async () => true),
}));

import { buildIllnessSnapshotBlock } from "@/lib/ai/coach/illness-snapshot";

const NOW = new Date("2026-06-01T12:00:00.000Z");

function episode(lifecycle: string, label: string, onset: string) {
  return {
    label,
    type: lifecycle === "CHRONIC_ONGOING" ? "CHRONIC" : "INFECTION",
    lifecycle,
    onsetAt: new Date(onset),
    bodySiteEncrypted: null,
    laterality: null,
  };
}

const CHRONIC = episode("CHRONIC_ONGOING", "Sleep apnoea", "2015-08-01");

beforeEach(() => {
  findMany.mockReset();
});

describe("buildIllnessSnapshotBlock — restMode (#1216)", () => {
  it("a chronic condition alone is context, not Rest Mode", async () => {
    findMany.mockResolvedValueOnce([CHRONIC]).mockResolvedValueOnce([]);
    const block = await buildIllnessSnapshotBlock("u1", NOW);
    expect(block?.restMode).toBe(false);
    expect(block?.active.map((e) => e.label)).toEqual(["Sleep apnoea"]);
  });

  it("an acute episode on top sets Rest Mode", async () => {
    findMany
      .mockResolvedValueOnce([CHRONIC, episode("ACUTE", "Cold", "2026-05-29")])
      .mockResolvedValueOnce([]);
    const block = await buildIllnessSnapshotBlock("u1", NOW);
    expect(block?.restMode).toBe(true);
    expect(block?.active).toHaveLength(2);
  });

  it("a flare under the chronic condition sets Rest Mode", async () => {
    findMany
      .mockResolvedValueOnce([CHRONIC, episode("FLARE", "Flare", "2026-05-30")])
      .mockResolvedValueOnce([]);
    const block = await buildIllnessSnapshotBlock("u1", NOW);
    expect(block?.restMode).toBe(true);
  });
});
