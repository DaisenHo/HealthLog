/**
 * The one token lifecycle every OAuth provider integration goes through.
 *
 * Six providers (Withings, WHOOP, Oura, Strava, Google Health, Polar) used to
 * carry their own copy of "read the stored grant, decide whether it needs a
 * refresh, refresh it, write it back". The copies drifted: two refreshed under
 * the advisory lock, one only compare-and-swapped, one did neither, and the
 * Withings status route refreshed with no guard at all. A provider now
 * describes where its grant lives and how its token endpoint is called
 * (`OAuthTokenDescriptor`), and this module owns the rest:
 *
 *   - A fresh token is returned straight from the row, without a transaction.
 *   - A refresh happens under the per-provider, per-user advisory lock
 *     (`acquireProviderTokenRefreshLock`). Under the lock the row is read again:
 *     a peer that refreshed while this caller waited, or a reconnect that
 *     stored a new grant, wins, and its token is used instead of refreshing a
 *     second time. Spending a one-time refresh token twice is what an
 *     authorization server reads as theft.
 *   - The write is conditional on the refresh ciphertext the refresh spent, so
 *     a reconnect that lands while the provider answers (it takes no lock) is
 *     never overwritten by the older grant.
 *   - A provider that does not rotate refresh tokens keeps the stored one when
 *     the response carries none.
 *
 * Storage is unchanged by design: every descriptor reads and writes the
 * columns the provider always used, so no connection has to reconnect.
 *
 * What stays with the provider: classifying a refused refresh, recording it on
 * the integration ledger, and the provider's own reauth flag. The kit throws
 * the provider's own error untouched, so those branches keep working.
 */
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import {
  acquireProviderTokenRefreshLock,
  PROVIDER_REFRESH_TRANSACTION_OPTIONS,
} from "@/lib/integrations/oauth-refresh";

/** The OAuth integrations whose tokens the kit manages. */
export type OAuthKitProvider =
  "withings" | "whoop" | "oura" | "strava" | "google-health" | "polar";

/** Read and write access the descriptor gets: the client or a transaction. */
export type OAuthKitDb = Prisma.TransactionClient;

/** A grant as stored, still sealed. */
export interface StoredGrant {
  /** Ciphertext of the access token. */
  readonly accessCiphertext: string;
  /** Ciphertext of the refresh token; null for a provider without one. */
  readonly refreshCiphertext: string | null;
  /** When the access token stops working; null when the provider gives none. */
  readonly expiresAt: Date | null;
}

/** The sealed grant a refresh writes back. */
export interface NextGrant {
  readonly accessCiphertext: string;
  readonly refreshCiphertext: string;
  readonly expiresAt: Date | null;
}

/** What a provider's token endpoint answered on a refresh. */
export interface RefreshedGrant {
  readonly access_token: string;
  readonly refresh_token?: string | null;
  readonly expires_in?: number | null;
}

export interface OAuthTokenDescriptor<Credentials> {
  readonly provider: OAuthKitProvider;
  /**
   * True when the provider stores an expiry and the token is refreshed ahead
   * of it. False for the providers that refresh only after a refusal (Oura,
   * Strava) or never (Polar).
   */
  readonly tracksExpiry: boolean;
  /** How long before the expiry a token counts as stale. */
  readonly expiryBufferMs: number;
  /** Read the stored grant, or null when the user has no connection. */
  readGrant(db: OAuthKitDb, userId: string): Promise<StoredGrant | null>;
  /**
   * Write a refreshed grant, only while the stored refresh ciphertext still
   * equals `spentRefreshCiphertext`. Returns the number of rows written.
   */
  writeGrant(
    db: OAuthKitDb,
    userId: string,
    spentRefreshCiphertext: string,
    next: NextGrant,
  ): Promise<number>;
  /** The OAuth client the refresh authenticates as, or null when none is set. */
  loadCredentials(userId: string): Promise<Credentials | null>;
  /** Call the token endpoint. Null for a provider without refresh tokens. */
  readonly refresh:
    | ((
        refreshToken: string,
        credentials: Credentials,
      ) => Promise<RefreshedGrant>)
    | null;
}

export type AccessTokenResult =
  | { readonly kind: "none" }
  | { readonly kind: "no_credentials" }
  | {
      readonly kind: "token";
      readonly accessToken: string;
      readonly expiresAt: Date | null;
      /** The refresh ciphertext stored beside the token, for a later refusal. */
      readonly refreshCiphertext: string | null;
      /** True when this call refreshed the token itself. */
      readonly refreshed: boolean;
    };

export interface ObtainAccessTokenOptions {
  /**
   * The token was just refused. Refresh unless a peer already did: pass the
   * refresh ciphertext the refused token was read with. A stored ciphertext
   * that differs from it means the grant moved on since, and its token is
   * used as it is.
   */
  readonly afterRefusalOf?: string;
  /** Refresh even when the stored expiry says the token is still good. */
  readonly force?: boolean;
  /** Clock override for tests. */
  readonly now?: () => number;
}

function isFresh(
  descriptor: Pick<
    OAuthTokenDescriptor<unknown>,
    "tracksExpiry" | "expiryBufferMs"
  >,
  grant: StoredGrant,
  now: number,
): boolean {
  if (!descriptor.tracksExpiry || grant.expiresAt === null) return true;
  return grant.expiresAt.getTime() - descriptor.expiryBufferMs >= now;
}

function tokenOf(grant: StoredGrant, refreshed: boolean): AccessTokenResult {
  return {
    kind: "token",
    accessToken: decrypt(grant.accessCiphertext),
    expiresAt: grant.expiresAt,
    refreshCiphertext: grant.refreshCiphertext,
    refreshed,
  };
}

/**
 * A usable access token for the user's connection, refreshing it when it is
 * stale, forced, or was just refused. Throws whatever the provider's token
 * endpoint threw, for the provider to classify and record.
 */
export async function obtainAccessToken<Credentials>(
  descriptor: OAuthTokenDescriptor<Credentials>,
  userId: string,
  opts: ObtainAccessTokenOptions = {},
): Promise<AccessTokenResult> {
  const now = opts.now ?? Date.now;
  const observed = await descriptor.readGrant(prisma, userId);
  if (!observed) return { kind: "none" };

  const wantsRefresh =
    opts.force === true ||
    opts.afterRefusalOf !== undefined ||
    !isFresh(descriptor, observed, now());
  if (
    !wantsRefresh ||
    descriptor.refresh === null ||
    observed.refreshCiphertext === null
  ) {
    return tokenOf(observed, false);
  }

  const credentials = await descriptor.loadCredentials(userId);
  if (!credentials) return { kind: "no_credentials" };

  const refresh = descriptor.refresh;
  // What the caller's view of the grant was. A refusal names the ciphertext
  // its token was read with; otherwise it is what was just read above.
  const spentView = opts.afterRefusalOf ?? observed.refreshCiphertext;

  return prisma.$transaction(async (tx) => {
    await acquireProviderTokenRefreshLock(tx, descriptor.provider, userId);
    const current = await descriptor.readGrant(tx, userId);
    if (!current || current.refreshCiphertext === null) {
      return { kind: "none" } as const;
    }
    // The grant moved on while this caller waited for the lock or used its
    // token: a peer refreshed it, or a reconnect replaced it. Use that one.
    // A non-rotating provider keeps its refresh ciphertext, so its access
    // ciphertext tells the same story.
    const movedOn =
      current.refreshCiphertext !== spentView ||
      (opts.afterRefusalOf === undefined &&
        current.accessCiphertext !== observed.accessCiphertext);
    if (movedOn && isFresh(descriptor, current, now())) {
      return tokenOf(current, false);
    }
    if (
      !movedOn &&
      opts.force !== true &&
      opts.afterRefusalOf === undefined &&
      isFresh(descriptor, current, now())
    ) {
      return tokenOf(current, false);
    }

    const rotated = await refresh(
      decrypt(current.refreshCiphertext),
      credentials,
    );
    const expiresAt = descriptor.tracksExpiry
      ? new Date(now() + (rotated.expires_in ?? 3600) * 1000)
      : null;
    const next: NextGrant = {
      accessCiphertext: encrypt(rotated.access_token),
      refreshCiphertext: rotated.refresh_token
        ? encrypt(rotated.refresh_token)
        : current.refreshCiphertext,
      expiresAt,
    };
    const written = await descriptor.writeGrant(
      tx,
      userId,
      current.refreshCiphertext,
      next,
    );
    if (written > 0) {
      return {
        kind: "token",
        accessToken: rotated.access_token,
        expiresAt,
        refreshCiphertext: next.refreshCiphertext,
        refreshed: true,
      } as const;
    }
    // A reconnect stored a new grant while the provider answered; it wins.
    const replaced = await descriptor.readGrant(tx, userId);
    return replaced ? tokenOf(replaced, false) : ({ kind: "none" } as const);
  }, PROVIDER_REFRESH_TRANSACTION_OPTIONS);
}
