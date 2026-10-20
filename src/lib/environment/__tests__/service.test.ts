/**
 * v1.25 — conservative location resolution.
 *
 * Pins the precedence (explicit period → [DEVICE, reserved] → home-on/after-
 * effective-from → SKIP) and the conservative default backfill range. The whole
 * point is that a past day is NEVER attributed to the current home unless the
 * home was already effective on that day; otherwise it is skipped and left to an
 * explicit location period. `@/lib/db` + the Open-Meteo client are stubbed so
 * the pure functions import without touching Postgres or the network.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/environment/open-meteo", () => ({
  fetchDailyEnvironment: vi.fn(),
}));

import {
  resolveLocationForDay,
  defaultBackfillRange,
  utcDayKey,
} from "../service";

const HOME = {
  lat: 52.5,
  lon: 13.4,
  label: "Home City",
  timezone: "Europe/Berlin",
  since: "2026-03-01",
};

const PERIOD = {
  startDate: "2026-01-10",
  endDate: "2026-01-20",
  lat: 28.1,
  lon: -15.4,
  label: "Past City",
};

describe("resolveLocationForDay (conservative)", () => {
  it("uses an explicit location period covering the day", () => {
    const r = resolveLocationForDay("2026-01-15", HOME, [PERIOD]);
    expect(r).toEqual({
      lat: PERIOD.lat,
      lon: PERIOD.lon,
      label: PERIOD.label,
      source: "TRAVEL",
    });
  });

  it("honours an explicit period even before the home was effective", () => {
    // The period (Jan) predates homeSince (Mar) — it must still win, since it is
    // the mechanism for correcting history.
    const r = resolveLocationForDay("2026-01-12", HOME, [PERIOD]);
    expect(r?.source).toBe("TRAVEL");
  });

  it("uses home for a day on/after homeSince when no period covers it", () => {
    const r = resolveLocationForDay("2026-03-02", HOME, [PERIOD]);
    expect(r).toEqual({
      lat: HOME.lat,
      lon: HOME.lon,
      label: HOME.label,
      source: "HOME",
    });
  });

  it("uses home on the exact homeSince day (inclusive boundary)", () => {
    expect(resolveLocationForDay("2026-03-01", HOME, [])?.source).toBe("HOME");
  });

  it("SKIPS a day before homeSince rather than fabricating from current home", () => {
    // Feb is before homeSince (Mar) and uncovered by any period → no row.
    expect(resolveLocationForDay("2026-02-15", HOME, [])).toBeNull();
  });

  it("skips when no home and no covering period", () => {
    expect(resolveLocationForDay("2026-05-01", null, [])).toBeNull();
  });

  it("skips when home has no effective-from date", () => {
    const homeNoSince = { ...HOME, since: null };
    expect(resolveLocationForDay("2026-05-01", homeNoSince, [])).toBeNull();
  });
});

describe("defaultBackfillRange (conservative)", () => {
  it("spans [homeSince .. today]", () => {
    const since = new Date("2026-03-01T10:00:00Z");
    const today = new Date("2026-06-28T00:00:00Z");
    expect(defaultBackfillRange(since, today)).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-06-28",
    });
  });

  it("returns null without a home effective-from", () => {
    expect(defaultBackfillRange(null)).toBeNull();
  });

  it("derives the start day-key from the homeSince instant", () => {
    const since = new Date("2026-03-01T23:30:00Z");
    expect(
      defaultBackfillRange(since, new Date("2026-03-05T00:00:00Z")),
    ).toEqual({ startDate: utcDayKey(since), endDate: "2026-03-05" });
  });
});
