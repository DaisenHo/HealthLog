/**
 * Time-zone and day-boundary helpers against their laws, on random instants
 * in zones chosen for their awkward offsets and transitions.
 *
 * The hand-written cases next door pin the transitions somebody thought of;
 * these generate the ones nobody did. Each property states something a
 * person would notice if it broke: a reading filed under the wrong day, a
 * reminder an hour off on a transition day, a day that does not contain its
 * own instants.
 */
import fc from "fast-check";
import { describe, it, expect } from "vitest";

import {
  daysBetweenDateKeys,
  shiftDateKey,
  tzOffsetMinutes,
  userDayKey,
  weekdayOfDateKey,
} from "@/lib/tz/format";
import { localDayWindow, startOfLocalDayInTz } from "@/lib/tz/local-day";
import { wallClockInTz, zonedWallClockToUtc } from "@/lib/tz/wall-clock";
import { startOfUtcDay } from "@/lib/tz/start-of-utc-day";
import { dateOnlyAtNoonUtc, dateOnlyKey } from "@/lib/tz/date-only";

import {
  assertProperty,
  instantArb,
  zoneArb,
} from "../../../../tests/property/fast-check";

/** The oracle: what `Intl` itself reads off the wall clock. */
function intlWallClock(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: weekdays.indexOf(get("weekday")),
  };
}

const dayKeyArb = fc
  .date({
    min: new Date("1996-01-01T00:00:00Z"),
    max: new Date("2039-12-31T00:00:00Z"),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10));

describe("wall clock in a zone", () => {
  it("reads the same wall clock as Intl for any instant and zone", () => {
    assertProperty(
      fc.property(instantArb, zoneArb, (date, tz) => {
        expect(wallClockInTz(date, tz)).toEqual(intlWallClock(date, tz));
      }),
      400,
    );
  });

  it("maps a wall clock that exists back to an instant showing that wall clock", () => {
    assertProperty(
      fc.property(instantArb, zoneArb, (date, tz) => {
        const wall = wallClockInTz(date, tz);
        const back = zonedWallClockToUtc(wall, tz);
        const again = wallClockInTz(back, tz);
        expect(again).toEqual(wall);
        // Inside a repeated hour the inverse may pick the other occurrence;
        // it never lands further away than the largest DST shift.
        const truncated = Math.floor(date.getTime() / 1000) * 1000;
        expect(Math.abs(back.getTime() - truncated)).toBeLessThanOrEqual(
          2 * 3_600_000,
        );
      }),
      400,
    );
  });

  it("resolves a wall clock inside a skipped hour forward, on the same day", () => {
    assertProperty(
      fc.property(
        instantArb,
        zoneArb,
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (date, tz, hour, minute) => {
          const day = wallClockInTz(date, tz);
          const wanted = { ...day, hour, minute, second: 0 };
          const resolved = zonedWallClockToUtc(wanted, tz);
          const shown = wallClockInTz(resolved, tz);
          const asIfUtc = (w: typeof wanted) =>
            Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute);
          const drift = asIfUtc(shown) - asIfUtc(wanted);
          // Either the wall clock exists and is hit exactly, or it falls in a
          // gap and is read with the offset before the gap: later, never
          // earlier, by at most the size of the gap.
          expect(drift).toBeGreaterThanOrEqual(0);
          expect(drift).toBeLessThanOrEqual(2 * 3_600_000);
        },
      ),
      400,
    );
  });

  it("agrees with the offset helper on the zone offset", () => {
    assertProperty(
      fc.property(instantArb, zoneArb, (date, tz) => {
        const wall = intlWallClock(date, tz);
        const asIfUtc = Date.UTC(
          wall.year,
          wall.month - 1,
          wall.day,
          wall.hour,
          wall.minute,
          wall.second,
        );
        const expected = Math.round((asIfUtc - date.getTime()) / 60_000);
        expect(tzOffsetMinutes(date, tz)).toBe(expected);
      }),
      300,
    );
  });
});

describe("local days", () => {
  it("files an instant under a day whose window contains it", () => {
    assertProperty(
      fc.property(instantArb, zoneArb, (date, tz) => {
        const key = userDayKey(date, tz);
        const { dayStart, dayEnd } = localDayWindow(key, tz);
        expect(dayStart.getTime()).toBeLessThanOrEqual(date.getTime());
        expect(date.getTime()).toBeLessThan(dayEnd.getTime());
        expect(startOfLocalDayInTz(date, tz).getTime()).toBe(
          dayStart.getTime(),
        );
      }),
      400,
    );
  });

  it("never files a later instant under an earlier day", () => {
    assertProperty(
      fc.property(instantArb, instantArb, zoneArb, (a, b, tz) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        expect(userDayKey(early, tz) <= userDayKey(late, tz)).toBe(true);
      }),
      400,
    );
  });

  it("makes every local day between 22 and 26 hours long and contiguous with the next", () => {
    assertProperty(
      fc.property(dayKeyArb, zoneArb, (key, tz) => {
        const today = localDayWindow(key, tz);
        const tomorrow = localDayWindow(shiftDateKey(key, 1), tz);
        const hours =
          (today.dayEnd.getTime() - today.dayStart.getTime()) / 3_600_000;
        expect(hours).toBeGreaterThanOrEqual(22);
        expect(hours).toBeLessThanOrEqual(26);
        expect(tomorrow.dayStart.getTime()).toBe(today.dayEnd.getTime());
        expect(userDayKey(today.dayStart, tz)).toBe(key);
      }),
      300,
    );
  });
});

describe("day keys", () => {
  it("shifts and counts days as inverses of each other", () => {
    assertProperty(
      fc.property(
        dayKeyArb,
        fc.integer({ min: -2000, max: 2000 }),
        (key, delta) => {
          const shifted = shiftDateKey(key, delta);
          expect(daysBetweenDateKeys(key, shifted)).toBe(delta);
          expect(shiftDateKey(shifted, -delta)).toBe(key);
        },
      ),
    );
  });

  it("keeps the weekday across whole weeks and advances it by one per day", () => {
    assertProperty(
      fc.property(
        dayKeyArb,
        fc.integer({ min: -300, max: 300 }),
        (key, weeks) => {
          const weekday = weekdayOfDateKey(key);
          expect(weekdayOfDateKey(shiftDateKey(key, weeks * 7))).toBe(weekday);
          expect(weekdayOfDateKey(shiftDateKey(key, 1))).toBe(
            (weekday + 1) % 7,
          );
        },
      ),
    );
  });

  it("stores a date-only value at noon UTC and reads the same date back", () => {
    assertProperty(
      fc.property(dayKeyArb, (key) => {
        expect(dateOnlyKey(dateOnlyAtNoonUtc(key))).toBe(key);
      }),
    );
  });

  it("floors an instant to its UTC day, idempotently", () => {
    assertProperty(
      fc.property(instantArb, (date) => {
        const floor = startOfUtcDay(date);
        expect(floor.getTime()).toBeLessThanOrEqual(date.getTime());
        expect(date.getTime() - floor.getTime()).toBeLessThan(86_400_000);
        expect(startOfUtcDay(floor).getTime()).toBe(floor.getTime());
        expect(floor.toISOString().endsWith("T00:00:00.000Z")).toBe(true);
      }),
    );
  });
});
