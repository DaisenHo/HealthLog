/**
 * One answer to "what does an event do on a channel with no stored row".
 *
 * The dispatcher and the `/notifications` matrix used to answer it apart: the
 * dispatcher derived the mood reminder from the reminder card, the matrix read
 * the constant table, and an account receiving the reminder saw it switched
 * off. Both now read `event-defaults.ts`; this file pins what it answers and
 * that nothing on the client keeps its own copy of the table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/db";
import { walkSourceFiles } from "@/__tests__/helpers/source-files";
import { EVENT_DEFAULT_ENABLED, EVENT_TYPES } from "@/lib/notifications/types";
import {
  eventDefaultFor,
  eventDefaultsFor,
  resolveEventDefault,
  resolveEventDefaults,
} from "../event-defaults";

const findUnique = vi.mocked(prisma.user.findUnique);

beforeEach(() => {
  findUnique.mockReset();
});

describe("eventDefaultsFor", () => {
  it("follows the reminder card for the mood reminder", () => {
    expect(eventDefaultsFor({ moodReminderEnabled: true }).MOOD_REMINDER).toBe(
      true,
    );
    expect(eventDefaultsFor({ moodReminderEnabled: false }).MOOD_REMINDER).toBe(
      false,
    );
  });

  it("answers every other event from the constant table", () => {
    const map = eventDefaultsFor({ moodReminderEnabled: true });
    for (const eventType of EVENT_TYPES) {
      if (eventType === "MOOD_REMINDER") continue;
      expect(map[eventType], eventType).toBe(EVENT_DEFAULT_ENABLED[eventType]);
    }
  });

  it("covers every event the server knows", () => {
    expect(
      Object.keys(eventDefaultsFor({ moodReminderEnabled: false })).sort(),
    ).toEqual([...EVENT_TYPES].sort());
  });

  it("keeps the opt-out default for an event it does not know", () => {
    expect(
      eventDefaultFor("NOT_AN_EVENT", { moodReminderEnabled: false }),
    ).toBe(true);
  });
});

describe("the account reads", () => {
  it("the map and the dispatcher's per-event answer agree", async () => {
    findUnique.mockResolvedValue({ moodReminderEnabled: true } as never);
    const map = await resolveEventDefaults("u1");
    for (const eventType of EVENT_TYPES) {
      expect(await resolveEventDefault("u1", eventType), eventType).toBe(
        map[eventType],
      );
    }
  });

  it("reads the account only for an event whose default follows it", async () => {
    await resolveEventDefault("u1", "MEDICATION_REMINDER");
    expect(findUnique).not.toHaveBeenCalled();
    findUnique.mockResolvedValue({ moodReminderEnabled: false } as never);
    expect(await resolveEventDefault("u1", "MOOD_REMINDER")).toBe(false);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe("no client keeps a copy of the table", () => {
  it("nothing under src/app or src/components imports EVENT_DEFAULT_ENABLED", () => {
    const root = join(process.cwd(), "src");
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      // The floor makes a walk that found nothing fail instead of passing.
      for (const rel of walkSourceFiles(join(root, dir), { floor: 300 })) {
        if (rel.includes("__tests__/")) continue;
        const text = readFileSync(join(root, dir, rel), "utf8");
        if (text.includes("EVENT_DEFAULT_ENABLED")) {
          offenders.push(`${dir}/${rel}`);
        }
      }
    }
    // The same matcher has to find the server modules that do hold the
    // table, or an empty offender list proves nothing about the matcher.
    const serverHolders = walkSourceFiles(join(root, "lib"), { floor: 300 })
      .filter((rel) => !rel.includes("__tests__/"))
      .filter((rel) =>
        readFileSync(join(root, "lib", rel), "utf8").includes(
          "EVENT_DEFAULT_ENABLED",
        ),
      );
    expect(serverHolders.length).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });
});
