/**
 * `GET /api/nutrients/catalog` — the nutrient catalogue as the forms use it.
 *
 * One entry per code: canonical unit, label in the account's language,
 * whether HealthKit may send it (`syncable`), the input units with their
 * factor to the canonical unit, and the tolerable upper intake level with its
 * scope and source (or null). Clients build the composition form from this
 * and never convert units themselves.
 */
import { apiHandler, requireRecordAuth } from "@/lib/api-handler";
import { notImplemented } from "@/lib/http/not-implemented";
import { requireModuleEnabled } from "@/lib/modules/gate";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await requireRecordAuth("read", "measurements");
  const gate = await requireModuleEnabled(user.id, "nutrients");
  if (!gate.enabled) return gate.response;

  return notImplemented("nutrients.catalog.get");
});
