import { describe, expect, it } from "vitest";

import { eventStorage } from "@/lib/logging/context";
import { WideEventBuilder } from "@/lib/logging/event-builder";
import {
  DATETIME_NO_SECONDS_COUNTER,
  isoDateTime,
} from "@/lib/validations/datetime";

describe("validation.datetime.no_seconds", () => {
  it("counts each minute-precision refusal on the request's wide event", () => {
    const builder = new WideEventBuilder("http");
    eventStorage.run(builder, () => {
      const s = isoDateTime();
      s.safeParse("2026-10-15T06:15Z");
      s.safeParse("2026-10-15T07:15+02:00");
      s.safeParse("2026-10-15T07:15:00Z");
      s.safeParse("garbage");
    });
    expect(builder.toJSON().meta?.[DATETIME_NO_SECONDS_COUNTER]).toBe(2);
  });

  it("leaves a request without such a refusal untouched", () => {
    const builder = new WideEventBuilder("http");
    eventStorage.run(builder, () => {
      isoDateTime().safeParse("2026-10-15T07:15:00Z");
    });
    expect(
      builder.toJSON().meta?.[DATETIME_NO_SECONDS_COUNTER],
    ).toBeUndefined();
  });

  it("is a no-op outside a request", () => {
    expect(() => isoDateTime().safeParse("2026-10-15T06:15Z")).not.toThrow();
  });
});
