/**
 * `POST /api/auth/claim/sso` — start claiming a managed profile through
 * single sign-on (#959).
 *
 * Anonymous, like the password claim beside it. `{ token, username }`: the
 * link is checked and the username reserved for the round trip, a sealed
 * `hl_claim` cookie (10 minutes, `httpOnly`, `Secure` through
 * `shouldEmitSecureCookie()`) carries `{ handoverId, username, exp }`, and the
 * answer names where to go: `{ redirectTo: "/api/auth/oidc/login?intent=claim" }`.
 * The OIDC callback binds the identity provider's subject to the profile. The
 * token never rides a URL. Works on a single-sign-on-only server; 404
 * `profile_claim.sso_unavailable` when no identity provider is configured.
 */
import { NextRequest } from "next/server";

import { apiHandler } from "@/lib/api-handler";
import { returnAllZodIssues, safeJson } from "@/lib/api-response";
import { getSession } from "@/lib/auth/session";
import { notImplemented } from "@/lib/http/not-implemented";
import { claimGate } from "@/lib/managed-profiles/claim-gate";
import { claimSsoSchema } from "@/lib/validations/claim-sso";

export const POST = apiHandler(async (request: NextRequest) => {
  // Refuses a signed-in caller and rate-limits the address, as the password
  // claim does.
  const gate = await claimGate(request, "claim", (await getSession()) !== null);
  if (gate.refusal) return gate.refusal;

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 4 * 1024,
  });
  if (jsonError) return jsonError;
  const parsed = claimSsoSchema.safeParse(body);
  if (!parsed.success) return returnAllZodIssues(parsed.error, 422);

  return notImplemented("profile_claim.sso.start");
});
