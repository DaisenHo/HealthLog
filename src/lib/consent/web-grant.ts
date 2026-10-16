/**
 * Web AI-consent receipt minting.
 *
 * The `ConsentReceipt` gate (`src/lib/ai/consent-guard.ts` and the capability
 * resolver) requires an active receipt before any health data leaves through
 * a credential the operator holds (the operator's key, the shared ChatGPT
 * account). This helper records the web side of that consent: the person
 * pressed "Agree" on a card that named the provider and the data.
 *
 * It is only ever called for that explicit act. From v1.16.13 until v1.43.2
 * the AI settings page also called it on mount to "heal" accounts that
 * predated the gate, which minted a receipt for people who had agreed to
 * nothing and let background jobs send their data to the operator's provider.
 * That path is gone; the route refuses a request without `confirm: true`.
 *
 * Idempotent: a person with an active `ai_full` receipt is a no-op, so a
 * double tap leaves exactly one. Because every call is the person's own
 * consent act, it may follow an earlier withdrawal, exactly as a first grant
 * would. Withdrawal stays on `DELETE /api/consent/ai/latest`.
 *
 * The artefact is a small JSON record of the grant (source, kind, time, and
 * that it was confirmed); no signed PDF or JWT. It stays well under the 64 KB
 * artefact cap.
 */
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { isP2002 } from "@/lib/prisma-errors";
import { latestActiveReceipt } from "@/lib/consent/receipts";
import type { ConsentReceipt } from "@/lib/consent/receipts";

/** Outcome of an explicit web grant. */
export type WebConsentGrantResult =
  | { minted: true; receipt: ConsentReceipt }
  | { minted: false; reason: "already_active" };

/**
 * Record the person's explicit `ai_full` consent, minting a receipt when none
 * is active. `ai_full` is the master kind that satisfies every surface gate
 * (analysis, Coach, reading documents).
 */
export async function grantWebAiConsent(
  userId: string,
  now: Date = new Date(),
): Promise<WebConsentGrantResult> {
  // Fast path: a double tap finds the first tap's receipt without opening a
  // transaction.
  const existing = await latestActiveReceipt(userId, "ai_full");
  if (existing) return { minted: false, reason: "already_active" };

  const artefact = JSON.stringify({
    source: "web",
    kind: "ai_full",
    grantedAt: now.toISOString(),
    confirmed: true,
    note: "Explicit AI consent: the person pressed Agree on the web consent card.",
  });

  // Two taps can pass the fast-path read concurrently. The transaction
  // re-checks under Serializable so the second sees the first's row; the
  // partial unique index (migration 0159, `WHERE revoked_at IS NULL`) is the
  // structural backstop. A unique violation from it means a concurrent grant
  // already won, which is success-shaped.
  try {
    return await prisma.$transaction(
      async (tx) => {
        const inTx = await tx.consentReceipt.findFirst({
          where: { userId, kind: "ai_full", revokedAt: null },
          orderBy: { createdAt: "desc" },
        });
        if (inTx) return { minted: false, reason: "already_active" } as const;
        const receipt = await tx.consentReceipt.create({
          data: { userId, kind: "ai_full", artefact, signedAt: now },
        });
        return { minted: true, receipt } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (isP2002(err)) return { minted: false, reason: "already_active" };
    throw err;
  }
}
