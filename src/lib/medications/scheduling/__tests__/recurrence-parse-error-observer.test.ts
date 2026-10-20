/**
 * A recurrence rule that does not parse still reaches the wide event on the
 * server, now that the scheduling module no longer imports the logging
 * context (it runs in the browser too).
 */
import { describe, expect, it } from "vitest";

import { WideEventBuilder } from "@/lib/logging/event-builder";
import { eventStorage } from "@/lib/logging/context";
import { occurrencesBetween } from "../recurrence";

describe("recurrence parse error", () => {
  it("is annotated on the server's wide event", () => {
    const evt = new WideEventBuilder("http");
    const slots = eventStorage.run(evt, () =>
      occurrencesBetween(
        {
          id: "sched-1",
          rrule: "FREQ=NOPE;BYDAY=XX",
          rollingIntervalDays: null,
          timesOfDay: ["08:00"],
          daysOfWeek: null,
          windowStart: "08:00",
          windowEnd: "09:00",
          reminderGraceMinutes: null,
          scheduleType: "SCHEDULED",
          cyclicOnWeeks: null,
          cyclicOffWeeks: null,
        },
        new Date("2026-06-01T00:00:00Z"),
        new Date("2026-06-07T23:59:59Z"),
        {
          timeZone: "Europe/Berlin",
          lastIntakeAt: null,
          medication: {
            id: "med-1",
            startsOn: new Date("2026-06-01T00:00:00Z"),
            endsOn: null,
            oneShot: false,
            createdAt: new Date("2026-01-01T00:00:00Z"),
          },
        },
      ),
    );
    expect(slots).toEqual([]);
    const json = evt.toJSON() as {
      action?: { name: string };
      meta?: Record<string, unknown>;
    };
    expect(json.action?.name).toBe("medication.recurrence.parse_error");
    expect(json.meta?.rrule).toBe("FREQ=NOPE;BYDAY=XX");
  });
});
