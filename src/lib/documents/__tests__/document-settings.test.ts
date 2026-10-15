/**
 * #1217 — the automatic document read acts only while both the person's
 * switch is on and their AI usage level allows it. On `frugal` documents are
 * read on request only; the stored switch is left alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  user: { documentsAutoAiRead: true, aiUsageLevel: null as string | null },
  settings: {
    aiUsageMaxLevel: "FULL",
    aiUsageDefaultLevel: "STANDARD",
  } as Record<string, unknown> | null,
  failSettings: false,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(async () => db.user) },
    appSettings: {
      findUnique: vi.fn(async () => {
        if (db.failSettings) throw new Error("db down");
        return db.settings;
      }),
    },
  },
}));
vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
  getEvent: () => undefined,
}));

import { documentAutoReadEnabled } from "../document-settings";

beforeEach(() => {
  db.user = { documentsAutoAiRead: true, aiUsageLevel: null };
  db.settings = { aiUsageMaxLevel: "FULL", aiUsageDefaultLevel: "STANDARD" };
  db.failSettings = false;
});

describe("documentAutoReadEnabled", () => {
  it.each([
    ["FRUGAL", false],
    ["STANDARD", true],
    ["FULL", true],
    [null, true],
  ])("level %s with the switch on reads %s", async (level, expected) => {
    db.user = { documentsAutoAiRead: true, aiUsageLevel: level };
    expect(await documentAutoReadEnabled("u1")).toBe(expected);
  });

  it("stays off with the switch off, whatever the level", async () => {
    db.user = { documentsAutoAiRead: false, aiUsageLevel: "FULL" };
    expect(await documentAutoReadEnabled("u1")).toBe(false);
  });

  it("rests on a frugal instance default", async () => {
    db.settings = {
      aiUsageMaxLevel: "STANDARD",
      aiUsageDefaultLevel: "FRUGAL",
    };
    expect(await documentAutoReadEnabled("u1")).toBe(false);
  });
});
