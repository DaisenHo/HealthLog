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
import { apiSuccess } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { buildLifeCircumstances } from "@/lib/profile/life-circumstances";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await requireRecordAuth("read", "profile");
  const payload = await buildLifeCircumstances(user.id);
  annotate({
    action: { name: "anamnesis.life_circumstances.get" },
    meta: {
      fact_count: payload.sections.reduce(
        (sum, section) => sum + section.facts.length,
        0,
      ),
      audit_c_count: payload.auditC.history.length,
    },
  });
  return apiSuccess(payload);
});
