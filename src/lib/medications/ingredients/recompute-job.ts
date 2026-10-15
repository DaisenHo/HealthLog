/**
 * v1.43 — the `supplement-nutrient-recompute` queue: one account's whole
 * SUPPLEMENT history, recomputed after something that touches more than one
 * day changed (a composition saved, a medication deleted, its doses purged,
 * an import landed).
 *
 * The queue carries the `short` policy with a per-account `singletonKey`, the
 * shape the rollup recompute uses: sends that pile up while a pass is still
 * QUEUED collapse into it, which is safe because the handler reads the
 * account's live rows when it starts. A send issued while a pass is already
 * RUNNING queues a second one, so a change that lands mid-pass is never
 * stranded. The pass itself takes a per-account advisory lock.
 *
 * The queue MUST be registered in the rollup registrar
 * (`src/lib/jobs/reminder/register-rollup.ts`) so pg-boss provisions it.
 */
import { prisma } from "@/lib/db";
import { getGlobalBoss } from "@/lib/jobs/boss-instance";
import { annotate } from "@/lib/logging/context";

import { recomputeSupplementNutrientsForUser } from "./recompute";

export const SUPPLEMENT_NUTRIENT_RECOMPUTE_QUEUE =
  "supplement-nutrient-recompute";

/** Serial: a pass is a handful of queries per account. */
export const SUPPLEMENT_NUTRIENT_RECOMPUTE_CONCURRENCY = 1;

export interface SupplementNutrientRecomputePayload {
  userId: string;
  enqueuedAt: string;
}

/**
 * Queue the account's full recompute. `queued: true` when the worker has it
 * (a fresh job, or one already waiting that will read this change). When no
 * queue is reachable the pass runs inline so the change is never lost, and
 * the answer is `queued: false`.
 */
export async function enqueueSupplementNutrientRecompute(
  userId: string,
): Promise<{ queued: boolean }> {
  const boss = getGlobalBoss();
  if (boss) {
    try {
      const payload: SupplementNutrientRecomputePayload = {
        userId,
        enqueuedAt: new Date().toISOString(),
      };
      await boss.send(SUPPLEMENT_NUTRIENT_RECOMPUTE_QUEUE, payload, {
        retryLimit: 3,
        retryDelay: 30,
        retryBackoff: true,
        singletonKey: `supplement-nutrient-recompute|${userId}`,
      });
      // A null id means a pass for this account is already queued and will
      // read this change when it starts.
      return { queued: true };
    } catch (err) {
      annotate({
        action: { name: "supplement_nutrients.enqueue_failed" },
        meta: { reason: err instanceof Error ? err.name : "unknown" },
      });
    }
  }
  await recomputeSupplementNutrientsForUser(userId);
  return { queued: false };
}

/** The pg-boss handler body for one job. */
export async function runSupplementNutrientRecompute(
  payload: SupplementNutrientRecomputePayload,
): Promise<{ rowsWritten: number; ran: boolean }> {
  return recomputeSupplementNutrientsForUser(payload.userId);
}

/** Whether a medication has a stored composition (its doses add nutrients). */
export async function medicationHasComposition(
  userId: string,
  medicationId: string,
): Promise<boolean> {
  const row = await prisma.medicationIngredient.findFirst({
    where: { userId, medicationId },
    select: { id: true },
  });
  return Boolean(row);
}
