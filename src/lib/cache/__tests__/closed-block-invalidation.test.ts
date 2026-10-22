import { beforeEach, describe, expect, it } from "vitest";

import { closedBlockKeyPart, closedBlockUntouched } from "../closed-block";
import { invalidateUserMeasurements } from "../invalidate";
import { caches, type ServerCache } from "../server-cache";

const analytics = caches.analytics as ServerCache<{ v: number }>;

const USER = "u-closed";
const SPLIT = Date.UTC(2021, 9, 22);
const closedKey = `${USER}|pre-fold-remainder|${closedBlockKeyPart(SPLIT)}|x`;
const openKey = `${USER}|dashboard-snapshot|en`;

describe("closed analytics blocks", () => {
  beforeEach(() => {
    analytics.deleteByPrefix(`${USER}|`);
    analytics.set(closedKey, { v: 1 });
    analytics.set(openKey, { v: 2 });
  });

  it("reads the instant a closed block ends before", () => {
    expect(closedBlockUntouched(closedKey, new Date(SPLIT))).toBe(true);
    expect(closedBlockUntouched(closedKey, new Date(SPLIT - 1))).toBe(false);
    expect(closedBlockUntouched(openKey, new Date(SPLIT))).toBe(false);
  });

  it("survives a write of newer readings, evicting or marking stale", () => {
    for (const evict of [false, true]) {
      invalidateUserMeasurements(USER, {
        evict,
        touchedFrom: new Date(SPLIT + 86_400_000),
      });
      expect(analytics.get(closedKey)).toEqual({ v: 1 });
      expect(analytics.get(openKey)).toBeNull();
      analytics.set(openKey, { v: 2 });
    }
  });

  it("goes with a write that reaches before it, or does not say", () => {
    invalidateUserMeasurements(USER, { touchedFrom: new Date(SPLIT - 1) });
    expect(analytics.get(closedKey)).toBeNull();
    analytics.set(closedKey, { v: 1 });
    invalidateUserMeasurements(USER);
    expect(analytics.get(closedKey)).toBeNull();
  });
});
