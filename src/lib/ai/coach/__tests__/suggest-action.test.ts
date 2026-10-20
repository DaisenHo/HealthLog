/**
 * v1.22 — generalised confirm-card sentinel parse.
 *
 * Covers the CLOSED allowlist (checkup.create / reminder.note), the
 * field-by-field resolution, and the safety property that an unknown action
 * type or a malformed block yields NO action (never auto-applies, never mints
 * an arbitrary entity) while the prose is preserved and the raw marker stripped.
 */
import { describe, it, expect } from "vitest";

import {
  parseSuggestAction,
  isSuggestedActionType,
  isCheckupIntervalId,
} from "../suggest-action";

describe("parseSuggestAction", () => {
  it("resolves a checkup.create action with a closed interval id", () => {
    const raw = `You might add an annual panel.
---SUGGEST-ACTION---
action: checkup.create
label: Annual blood panel
interval: yearly
---END---`;
    const r = parseSuggestAction(raw);
    expect(r.malformed).toBe(false);
    expect(r.prose).toBe("You might add an annual panel.");
    expect(r.action?.actionType).toBe("checkup.create");
    expect(r.action?.summary).toBe("Annual blood panel");
    expect(r.action?.params).toEqual({
      actionType: "checkup.create",
      label: "Annual blood panel",
      interval: "yearly",
    });
  });

  it("resolves a reminder.note action with the closed when grammar token", () => {
    const raw = `---SUGGEST-ACTION---
action: reminder.note
note: revisit the evening-walk effect on sleep
when: +14d
metric: SLEEP
---END---`;
    const r = parseSuggestAction(raw);
    expect(r.action?.params).toEqual({
      actionType: "reminder.note",
      note: "revisit the evening-walk effect on sleep",
      when: "+14d",
      metric: "SLEEP",
    });
  });

  it("drops an unknown / off-allowlist action type (no entity, prose kept)", () => {
    const raw = `ok.
---SUGGEST-ACTION---
action: medication.create
label: start a new drug
interval: monthly
---END---`;
    const r = parseSuggestAction(raw);
    expect(r.action).toBeNull();
    expect(r.malformed).toBe(true);
    expect(r.prose).toBe("ok.");
    expect(r.prose).not.toContain("SUGGEST-ACTION");
  });

  it("drops a checkup with an unknown interval id", () => {
    const raw = `---SUGGEST-ACTION---
action: checkup.create
label: x
interval: hourly
---END---`;
    const r = parseSuggestAction(raw);
    expect(r.action).toBeNull();
    expect(r.malformed).toBe(true);
  });

  it("passes the prose through untouched when no block is present", () => {
    const r = parseSuggestAction("a normal reply");
    expect(r).toEqual({
      prose: "a normal reply",
      action: null,
      malformed: false,
    });
  });

  it("closed-allowlist guards reject anything off-list", () => {
    expect(isSuggestedActionType("checkup.create")).toBe(true);
    expect(isSuggestedActionType("reminder.note")).toBe(true);
    expect(isSuggestedActionType("medication.create")).toBe(false);
    expect(isCheckupIntervalId("yearly")).toBe(true);
    expect(isCheckupIntervalId("hourly")).toBe(false);
  });
});
