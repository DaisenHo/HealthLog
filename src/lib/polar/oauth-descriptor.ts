/**
 * Where a Polar grant lives, for the shared token lifecycle
 * (`src/lib/integrations/oauth-kit/token.ts`).
 *
 * Polar AccessLink tokens do not expire and come without a refresh token, so
 * the kit only reads them: there is nothing to refresh and nothing to write
 * back. A revoked grant surfaces as a refused read, and the person reconnects.
 */
import type { OAuthTokenDescriptor } from "@/lib/integrations/oauth-kit/token";

export const polarTokenDescriptor: OAuthTokenDescriptor<never> = {
  provider: "polar",
  tracksExpiry: false,
  expiryBufferMs: 0,
  async readGrant(db, userId) {
    const row = await db.user.findUnique({
      where: { id: userId },
      select: { polarAccessTokenEncrypted: true },
    });
    if (!row?.polarAccessTokenEncrypted) return null;
    return {
      accessCiphertext: row.polarAccessTokenEncrypted,
      refreshCiphertext: null,
      expiresAt: null,
    };
  },
  // Never reached: a grant without a refresh token is never refreshed.
  writeGrant: async () => 0,
  loadCredentials: async () => null,
  refresh: null,
};
