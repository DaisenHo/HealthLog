/**
 * v1.43 (#959) — claiming a managed profile through single sign-on. The
 * handover token and the chosen username ride a sealed cookie into the OIDC
 * round trip; the token never rides a URL.
 */
import { z } from "zod/v4";

import { accountUsernameSchema } from "@/lib/validations/auth";

export const claimSsoSchema = z.strictObject({
  token: z.string().min(1).max(80),
  username: accountUsernameSchema,
});
export type ClaimSsoInput = z.infer<typeof claimSsoSchema>;

/** How a handover link can be redeemed on this server. */
export const HANDOVER_METHODS = ["password", "sso"] as const;
