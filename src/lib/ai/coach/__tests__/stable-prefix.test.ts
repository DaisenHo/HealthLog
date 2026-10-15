/**
 * #1217 — the Coach's cached prefix (tools plus system prompt) is the same
 * string on every turn of a conversation. What changes per turn (the opener
 * hint, the name clause, a resolved follow-up, the table rules once a table
 * exists) travels in the user message, so a provider's prompt cache holds
 * from one turn to the next instead of being rewritten every time.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildCoachToolRequest } from "@/lib/ai/coach/chat-request-builder";
import {
  buildCoachTurnNotes,
  getCoachSystemPrompt,
} from "@/lib/ai/coach/system-prompt";
import { buildToolModeAddendum } from "@/lib/ai/coach/tools/system-addendum";
import {
  buildDialogAddenda,
  buildTableRulesAddendum,
} from "@/lib/ai/coach/turn/addenda";
import {
  openerArchetypeHint,
  shouldUseNameForTurn,
} from "@/lib/ai/prompts/opener-archetype";
import type { Locale } from "@/lib/i18n/config";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** One turn's request, assembled the way the turn model assembles it. */
function turnRequest(locale: Locale, turnIndex: number, hints: string[]) {
  const systemPrompt = getCoachSystemPrompt(locale, undefined, "I run.");
  const turnNotes = buildCoachTurnNotes(locale, {
    firstName: "Alex",
    mayUseName: shouldUseNameForTurn(`u1:${turnIndex}`),
    openerHint: openerArchetypeHint(`u1:${turnIndex}`, locale),
  });
  const tables = turnIndex > 1 ? [buildTableRulesAddendum(locale)] : [];
  return buildCoachToolRequest({
    systemPrompt,
    toolModeAddendum: `${buildToolModeAddendum(locale)}\n\n${buildDialogAddenda(
      locale,
      { tableRules: false },
    )}`,
    focusHint: "",
    workoutEvidence: null,
    dataInventory: "DATA INVENTORY\n- pulse",
    guidedBlock: "",
    transcript: `user: question ${turnIndex}`,
    languageName: "English",
    turnNotes: [...tables, turnNotes, ...hints]
      .filter((block) => block.length > 0)
      .join("\n\n"),
  });
}

describe("stable Coach prefix (#1217)", () => {
  it.each(["en", "de", "fr", "ko"] as Locale[])(
    "hashes the system prompt identically on every turn (%s)",
    (locale) => {
      const hashes = new Set<string>();
      for (let turn = 0; turn < 12; turn++) {
        const request = turnRequest(
          locale,
          turn,
          turn % 3 === 0 ? [`FOLLOW-UP: earlier answer ${turn}`] : [],
        );
        hashes.add(sha(request.system));
      }
      expect(hashes.size).toBe(1);
    },
  );

  it("carries the per-turn lines in the user message instead", () => {
    const opener = openerArchetypeHint("u1:4", "en");
    const request = turnRequest("en", 4, ["FOLLOW-UP: the pulse table"]);
    const user = String(request.messages[0]!.content);
    expect(user).toContain(opener);
    expect(user).toContain("FOLLOW-UP: the pulse table");
    expect(user).toContain(buildTableRulesAddendum("en"));
    expect(request.system).not.toContain(opener);
    expect(request.system).not.toContain("FOLLOW-UP");
    expect(request.system).not.toContain(buildTableRulesAddendum("en"));
  });

  it("keeps the opener hint and the name out of the system prompt", () => {
    for (const locale of ["en", "de"] as Locale[]) {
      const system = getCoachSystemPrompt(locale, undefined, null);
      expect(system).not.toMatch(
        /OPENER HINT for this turn|OPENER-HINWEIS für diesen Turn/,
      );
      expect(system).not.toContain("Alex");
    }
  });

  it("names the turn's opener and, on a gated turn, the first name", () => {
    const notes = buildCoachTurnNotes("en", {
      firstName: "Alex",
      mayUseName: true,
      openerHint: "Lead with the finding.",
    });
    expect(notes).toContain(
      "OPENER HINT for this turn: Lead with the finding.",
    );
    expect(notes).toContain('the user\'s first name is "Alex"');
    expect(buildCoachTurnNotes("en", {})).toBe("");
  });
});
