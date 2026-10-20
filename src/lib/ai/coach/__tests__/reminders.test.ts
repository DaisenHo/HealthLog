/**
 * v1.22 — Coach episodic reminder capture: grammar + sentinel + write.
 *
 * Covers the closed `when` grammar (ISO date / relative / context cue / reject),
 * the `---REMEMBER---` strip (capture, recall-only note, malformed drop, prose
 * preserved), and the cap-aware capture write.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/logging/context", () => ({ annotate: vi.fn() }));
vi.mock("../bytes-codec", () => ({
  encryptToBytes: (s: string) => new Uint8Array(Buffer.from(`enc:${s}`)),
}));

import {
  resolveWhenGrammar,
  parseRememberSentinel,
  captureReminderFromSentinel,
  MAX_REMINDERS_PER_USER,
} from "../reminders";

const NOW = new Date("2026-06-27T12:00:00.000Z");

describe("resolveWhenGrammar", () => {
  it("parses an ISO date into a date trigger at 09:00 UTC", () => {
    const r = resolveWhenGrammar("2026-07-11", NOW);
    expect(r).toEqual({
      triggerKind: "date",
      dueAt: new Date("2026-07-11T09:00:00.000Z"),
      contextCue: null,
    });
  });

  it("parses a relative +Nd / +Nw offset from now", () => {
    expect(resolveWhenGrammar("+14d", NOW)?.dueAt).toEqual(
      new Date("2026-07-11T12:00:00.000Z"),
    );
    expect(resolveWhenGrammar("+2w", NOW)?.dueAt).toEqual(
      new Date("2026-07-11T12:00:00.000Z"),
    );
  });

  it("parses a context cue into a context trigger (no dueAt)", () => {
    expect(resolveWhenGrammar("NEXT_BP_LOGGED", NOW)).toEqual({
      triggerKind: "context",
      dueAt: null,
      contextCue: "NEXT_BP_LOGGED",
    });
  });

  it("rejects an unknown / out-of-bounds token", () => {
    expect(resolveWhenGrammar("someday", NOW)).toBeNull();
    expect(resolveWhenGrammar("+0d", NOW)).toBeNull();
    expect(resolveWhenGrammar("+9999d", NOW)).toBeNull();
    expect(resolveWhenGrammar("NEXT_MOON", NOW)).toBeNull();
  });
});

describe("parseRememberSentinel", () => {
  it("captures note + when + metric and strips the block from the prose", () => {
    const raw = `Got it — I'll bring that up around the 11th.
---REMEMBER---
note: revisit the evening-walk idea for your sleep
when: 2026-07-11
metric: SLEEP
---END---`;
    const r = parseRememberSentinel(raw, NOW);
    expect(r.malformed).toBe(false);
    expect(r.prose).toBe("Got it — I'll bring that up around the 11th.");
    expect(r.reminder?.note).toBe(
      "revisit the evening-walk idea for your sleep",
    );
    expect(r.reminder?.metric).toBe("SLEEP");
    expect(r.reminder?.trigger?.dueAt).toEqual(
      new Date("2026-07-11T09:00:00.000Z"),
    );
  });

  it("captures a recall-only note when `when` is omitted", () => {
    const raw = `Noted.
---REMEMBER---
note: you wanted to discuss your labs
---END---`;
    const r = parseRememberSentinel(raw, NOW);
    expect(r.malformed).toBe(false);
    expect(r.reminder?.note).toBe("you wanted to discuss your labs");
    expect(r.reminder?.trigger).toBeNull();
  });

  it("drops the block (malformed) on a missing note or an invalid when, keeping prose", () => {
    const noNote = parseRememberSentinel(
      "Sure.\n---REMEMBER---\nwhen: 2026-07-11\n---END---",
      NOW,
    );
    expect(noNote.reminder).toBeNull();
    expect(noNote.malformed).toBe(true);
    expect(noNote.prose).toBe("Sure.");

    const badWhen = parseRememberSentinel(
      "Sure.\n---REMEMBER---\nnote: x\nwhen: someday\n---END---",
      NOW,
    );
    expect(badWhen.reminder).toBeNull();
    expect(badWhen.malformed).toBe(true);
    // The raw marker is never left in the prose.
    expect(badWhen.prose).not.toContain("REMEMBER");
  });

  it("returns the prose untouched when no block is present", () => {
    const r = parseRememberSentinel("just a normal reply", NOW);
    expect(r).toEqual({
      prose: "just a normal reply",
      reminder: null,
      malformed: false,
    });
  });
});

describe("captureReminderFromSentinel", () => {
  function db(count: number) {
    return {
      coachReminder: {
        count: vi.fn(async () => count),
        create: vi.fn(async () => ({ id: "r1" })),
      },
    };
  }

  it("writes a proposed reminder field-by-field with source sentinel", async () => {
    const d = db(0);
    const id = await captureReminderFromSentinel({
      userId: "u1",
      conversationId: "c1",
      parsed: {
        note: "revisit sleep",
        trigger: {
          triggerKind: "date",
          dueAt: new Date("2026-07-11T09:00:00.000Z"),
          contextCue: null,
        },
        metric: "SLEEP",
      },
      db: d as never,
    });
    expect(id).toBe("r1");
    const createArgs = d.coachReminder.create.mock.calls[0] as unknown as [
      {
        data: {
          userId: string;
          status: string;
          source: string;
          sourceConversationId: string;
          metric: string;
        };
      },
    ];
    const data = createArgs[0].data;
    expect(data.userId).toBe("u1");
    // v1.30.25 — a sentinel capture is a MODEL-driven write, so it lands as
    // `proposed` and waits for the user's confirm, exactly like an extracted
    // plan. `active` here would let a reminder induced by document-sourced
    // prompt text fire and re-enter the snapshot without the user ever
    // agreeing to it.
    expect(data.status).toBe("proposed");
    expect(data.source).toBe("sentinel");
    expect(data.sourceConversationId).toBe("c1");
    expect(data.metric).toBe("SLEEP");
  });

  it("refuses the write once the per-user cap is reached", async () => {
    const d = db(MAX_REMINDERS_PER_USER);
    const id = await captureReminderFromSentinel({
      userId: "u1",
      conversationId: "c1",
      parsed: { note: "x", trigger: null, metric: null },
      db: d as never,
    });
    expect(id).toBeNull();
    expect(d.coachReminder.create).not.toHaveBeenCalled();
  });
});
