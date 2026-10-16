/**
 * `POST /api/dawarich/test` — probe the connected Dawarich instance and answer
 * the shared integration probe shape. A failed probe is a 502 whose
 * `errorCode` is one of the shared probe classes (`credentials_rejected`,
 * `rate_limited`, `upstream_error`, `timeout`, `url_not_public`,
 * `connection_failed`); 422 `not_configured` without a connection. Part of the
 * `environment` module; own account only, five probes a minute.
 */
import { apiHandler, requireAuth } from "@/lib/api-handler";
import { apiError, apiSuccess } from "@/lib/api-response";
import {
  DawarichApiError,
  DawarichPolicyError,
  probeDawarich,
} from "@/lib/dawarich/client";
import { loadDawarichConnection } from "@/lib/dawarich/connection";
import { getIntegrationStatus } from "@/lib/integrations/status";
import { annotate } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { checkRateLimit } from "@/lib/rate-limit";
import { SafeFetchError } from "@/lib/safe-fetch";

const TIMEOUT_MS = 5_000;

function probeClass(error: unknown): { code: string; message: string } {
  if (error instanceof DawarichPolicyError) {
    return {
      code: "url_not_public",
      message:
        "The instance is on a private network the operator has not approved",
    };
  }
  if (error instanceof DawarichApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        code: "credentials_rejected",
        message: "Dawarich rejected the API key",
      };
    }
    if (error.status === 429) {
      return {
        code: "rate_limited",
        message: "Dawarich rate-limited the request",
      };
    }
    if (error.status !== null && error.status >= 500) {
      return { code: "upstream_error", message: "Dawarich returned an error" };
    }
  }
  if (error instanceof SafeFetchError && error.kind === "timeout") {
    return { code: "timeout", message: "Dawarich request timed out" };
  }
  return { code: "connection_failed", message: "Dawarich connection failed" };
}

export const POST = apiHandler(async () => {
  const { user } = await requireAuth();
  annotate({ action: { name: "dawarich.test" } });
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const rl = await checkRateLimit(`dawarich-test:${user.id}`, 5, 60_000);
  if (!rl.allowed) {
    return apiError("Too many test requests", 429, {
      errorCode: "rate_limited_self",
    });
  }

  const stored = await loadDawarichConnection(user.id);
  if (!stored) {
    return apiError("Dawarich not connected", 422, {
      errorCode: "not_configured",
    });
  }

  const start = performance.now();
  try {
    await probeDawarich(stored.connection, TIMEOUT_MS);
  } catch (error) {
    const probe = probeClass(error);
    annotate({ meta: { dawarich_test_code: probe.code } });
    return apiError(probe.message, 502, { errorCode: probe.code });
  }
  const latencyMs = Math.round(performance.now() - start);
  const ledger = await getIntegrationStatus(user.id, "dawarich");
  return apiSuccess({
    ok: true as const,
    lastSyncedAt: ledger.lastSuccessAt,
    latencyMs,
  });
});
