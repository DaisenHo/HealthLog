/**
 * `GET /api/anamnesis/life-circumstances` — the six life-circumstance
 * sections (#614) with their current answers, AI switches, review state,
 * the derived values (pack-years, activity minutes, free weekdays, screening
 * hints) and AUDIT-C with its instrument text in the account's language.
 *
 * The new fact kinds are served here and only here: `GET /api/anamnesis/facts`
 * keeps its three kinds for clients that decode that list closed. Delegates
 * read it under the `profile` grant, like the facts.
 */
import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { notImplemented } from "@/lib/http/not-implemented";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  await requireRecordAuth("read", "profile");
  return notImplemented("anamnesis.life_circumstances.get");
});
