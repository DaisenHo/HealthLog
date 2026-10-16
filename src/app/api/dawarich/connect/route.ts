/**
 * `POST /api/dawarich/connect` — connect a Dawarich instance (movement
 * context, daily values only).
 *
 * `{ url, apiKey }`; both sealed at rest. The URL must resolve to a public
 * host unless its origin is listed in `DAWARICH_PRIVATE_ORIGINS` (422
 * `private_origin_not_approved`). The key is checked against the instance
 * before anything is stored, then a 30-day backfill starts. Part of the
 * `environment` module; own account only, ten attempts a minute.
 *
 * Reconnecting to the same instance keeps the home place and country; a
 * different instance starts without them, because a place id means nothing
 * on another instance.
 */
import { NextRequest } from "next/server";

import { apiHandler, requireAuth } from "@/lib/api-handler";
import {
  apiError,
  apiSuccess,
  returnAllZodIssues,
  safeJson,
} from "@/lib/api-response";
import { auditLog } from "@/lib/auth/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  DawarichApiError,
  DawarichPolicyError,
  probeDawarich,
} from "@/lib/dawarich/client";
import {
  EMPTY_DAWARICH_PREFS,
  sealDawarichPrefs,
} from "@/lib/dawarich/connection";
import {
  configuredDawarichPrivateOrigins,
  DawarichOriginConfigError,
  evaluateDawarichUrl,
} from "@/lib/dawarich/origin";
import { yesterdayKey } from "@/lib/dawarich/sync";
import { prisma } from "@/lib/db";
import { markReconnected } from "@/lib/integrations/status";
import {
  DAWARICH_CONNECT_BACKFILL_DAYS,
  enqueueDawarichSync,
} from "@/lib/jobs/dawarich-sync";
import { annotate, getEvent } from "@/lib/logging/context";
import { requireModuleEnabled } from "@/lib/modules/gate";
import { INVALID_ORIGIN } from "@/lib/private-origin-policy";
import { checkRateLimit } from "@/lib/rate-limit";
import { shiftDateKey } from "@/lib/tz/format";
import { resolveUserTimezone } from "@/lib/tz/resolver";
import { dawarichConnectSchema } from "@/lib/validations/dawarich";

export const POST = apiHandler(async (request: NextRequest) => {
  const { user } = await requireAuth();
  annotate({ action: { name: "dawarich.connect" } });
  const gate = await requireModuleEnabled(user.id, "environment");
  if (!gate.enabled) return gate.response;

  const rl = await checkRateLimit(`dawarich-connect:${user.id}`, 10, 60_000);
  if (!rl.allowed) {
    return apiError("Too many attempts, try again later", 429, {
      errorCode: "dawarich.rate_limited",
    });
  }

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 4 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = dawarichConnectSchema.safeParse(body);
  if (!parsed.success) {
    return returnAllZodIssues(parsed.error, 422, {
      errorCode: "dawarich.invalid",
    });
  }

  // A malformed operator list is the operator's to fix: name the entry and
  // the reason instead of a 500.
  let privateOrigins: ReadonlySet<string>;
  try {
    privateOrigins = configuredDawarichPrivateOrigins();
  } catch (error) {
    if (error instanceof DawarichOriginConfigError) {
      annotate({ meta: { refused: "operator_origin_list_invalid" } });
      return apiError(error.message, 422, { errorCode: "dawarich.invalid" });
    }
    throw error;
  }

  // The SSRF floor applies to the value that gets stored, not only to the
  // probe below.
  const target = evaluateDawarichUrl(parsed.data.url, privateOrigins);
  if (!target.allowed || !target.baseUrl) {
    if (target.reasonCode === INVALID_ORIGIN) {
      return apiError(
        "Use the address of the Dawarich instance, without credentials or a query",
        422,
        { errorCode: "dawarich.invalid" },
      );
    }
    annotate({ meta: { refused: target.reasonCode } });
    return apiError(
      "A Dawarich instance on a private network needs the server operator's approval",
      422,
      { errorCode: "private_origin_not_approved" },
    );
  }
  const baseUrl = target.baseUrl;
  const apiKey = parsed.data.apiKey;

  try {
    await probeDawarich({ baseUrl, apiKey });
  } catch (error) {
    if (error instanceof DawarichPolicyError) {
      return apiError(
        "A Dawarich instance on a private network needs the server operator's approval",
        422,
        { errorCode: "private_origin_not_approved" },
      );
    }
    if (
      error instanceof DawarichApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      return apiError("Dawarich did not accept this API key", 422, {
        errorCode: "dawarich.credentials_rejected",
      });
    }
    annotate({
      meta: {
        dawarich_probe_status:
          error instanceof DawarichApiError ? error.status : null,
      },
    });
    return apiError(
      "Could not reach the Dawarich instance. Check the address and that it is online.",
      422,
      { errorCode: "dawarich.unreachable" },
    );
  }

  const previous = await prisma.user.findUnique({
    where: { id: user.id },
    select: { dawarichUrlEncrypted: true, dawarichPrefsEncrypted: true },
  });
  const sameInstance =
    previous?.dawarichUrlEncrypted != null &&
    decrypt(previous.dawarichUrlEncrypted) === baseUrl;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      dawarichUrlEncrypted: encrypt(baseUrl),
      dawarichApiKeyEncrypted: encrypt(apiKey),
      dawarichPrefsEncrypted: sameInstance
        ? (previous?.dawarichPrefsEncrypted ?? null)
        : sealDawarichPrefs(EMPTY_DAWARICH_PREFS),
      // Display only: the operator list is re-read before every request.
      dawarichAllowPrivateHost: target.privateOriginApproved,
    },
  });
  await markReconnected(user.id, "dawarich");
  await auditLog("dawarich.connect", {
    userId: user.id,
    details: { privateOrigin: target.privateOriginApproved },
  });

  // The first month arrives without waiting for the night. Best effort: the
  // nightly run is the safety net when no worker is bound.
  const tz = await resolveUserTimezone(user.id);
  const outcome = await enqueueDawarichSync({
    userId: user.id,
    fromDate: shiftDateKey(
      yesterdayKey(tz),
      -(DAWARICH_CONNECT_BACKFILL_DAYS - 1),
    ),
  }).catch((error: unknown) => {
    getEvent()?.addWarning(
      `dawarich backfill enqueue failed: ${error instanceof Error ? error.name : "unknown"}`,
    );
    return "failed" as const;
  });
  annotate({ meta: { dawarich_backfill: outcome } });

  return apiSuccess({ connected: true as const });
});
