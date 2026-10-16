import { describe, expect, it, vi } from "vitest";

import {
  DATETIME_NO_SECONDS_MESSAGE,
  isoDateTime,
  registerDatetimeNoSecondsObserver,
} from "@/lib/validations/datetime";

describe("isoDateTime", () => {
  it("accepts an instant with seconds, with or without fraction and offset", () => {
    const s = isoDateTime();
    for (const v of [
      "2026-10-15T06:15:00Z",
      "2026-10-15T06:15:00.000Z",
      "2026-10-15T06:15:00.123456Z",
      "2026-10-15T06:15:00+02:00",
    ]) {
      expect(s.safeParse(v).success, v).toBe(true);
    }
  });

  it("refuses a minute-precision instant and says seconds are missing", () => {
    for (const v of ["2026-10-15T06:15Z", "2026-10-15T06:15+02:00"]) {
      const r = isoDateTime().safeParse(v);
      expect(r.success, v).toBe(false);
      expect(r.error?.issues[0].message).toBe(DATETIME_NO_SECONDS_MESSAGE);
    }
  });

  it("keeps the caller's message for every other refusal", () => {
    const s = isoDateTime({ offset: false, message: "takenAt is bad" });
    expect(s.safeParse("yesterday").error?.issues[0].message).toBe(
      "takenAt is bad",
    );
    expect(s.safeParse("2026-10-15T06:15Z").error?.issues[0].message).toBe(
      DATETIME_NO_SECONDS_MESSAGE,
    );
  });

  it("offset: false accepts only Z and does not count an offset form", () => {
    const s = isoDateTime({ offset: false });
    expect(s.safeParse("2026-10-15T06:15:00Z").success).toBe(true);
    expect(s.safeParse("2026-10-15T06:15:00+02:00").success).toBe(false);
    expect(
      s.safeParse("2026-10-15T06:15+02:00").error?.issues[0].message,
    ).not.toBe(DATETIME_NO_SECONDS_MESSAGE);
  });

  it("tells the observer about minute-precision refusals only", () => {
    const seen = vi.fn();
    registerDatetimeNoSecondsObserver(seen);
    const s = isoDateTime();
    s.safeParse("2026-10-15T06:15Z");
    s.safeParse("not a date");
    s.safeParse("2026-10-15T06:15:00Z");
    expect(seen).toHaveBeenCalledTimes(1);
  });
});
