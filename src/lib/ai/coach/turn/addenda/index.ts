/**
 * The dialog addenda appended to the tool-mode system prompt: result
 * tables, clarification, the method line, follow-up chips. Each lives in its
 * own file; an empty one adds nothing, so a turn with every addendum empty
 * sends the prompt byte for byte as before.
 */
import type { Locale } from "@/lib/i18n/config";

import { clarifyAddendum } from "./clarify";
import { followUpsAddendum } from "./followups";
import { methodAddendum } from "./method";
import { resultsAddendum } from "./results";

/**
 * The addenda for a turn. `tableRules` adds the recheck and follow-up rules,
 * which only matter once there is a table to recheck or follow up on: the
 * turn sends them when the conversation already holds one, and from the
 * round after its own first table otherwise.
 */
export function buildDialogAddenda(
  locale: Locale,
  opts: { tableRules: boolean } = { tableRules: true },
): string {
  return [
    resultsAddendum(locale),
    clarifyAddendum(locale),
    ...(opts.tableRules
      ? [methodAddendum(locale), followUpsAddendum(locale)]
      : []),
  ]
    .filter((block) => block.length > 0)
    .join("\n\n");
}

/**
 * v1.43 (#1217) — the table rules alone (how a table was fetched, how to
 * follow up on one). They apply once the conversation holds a table, which can
 * change mid-turn, so they travel as a user-side note rather than switching the
 * system prompt: a switched system prompt rewrites the provider's cached
 * prefix on the costliest round of the turn.
 */
export function buildTableRulesAddendum(locale: Locale): string {
  return [methodAddendum(locale), followUpsAddendum(locale)]
    .filter((block) => block.length > 0)
    .join("\n\n");
}
