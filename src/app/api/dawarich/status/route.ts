/**
 * `GET /api/dawarich/status` — whether Dawarich is connected, the home place
 * and country state, how many days are stored and the connection `health`
 * (the same shape every connection publishes; no legacy ledger fields).
 * Part of the `environment` module; own account only.
 */
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiSuccess } from "@/lib/api-response";
import { loadDawarichStatus } from "@/lib/dawarich/status";
import { annotate } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "dawarich.status" } });
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;
  return apiSuccess(await loadDawarichStatus(user.id));
});
