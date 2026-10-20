import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "@/lib/db";
import { decryptFromBytes, encryptToBytes } from "@/lib/ai/coach/bytes-codec";
import {
  invalidateUserDashboardSnapshot,
  invalidateUserInsights,
} from "@/lib/cache/invalidate";
import { getEvent } from "@/lib/logging/context";
import {
  HEALTH_PROFILE_FACT_KINDS,
  isHealthProfileFactValue,
  type HealthProfileFactKind,
  type HealthProfileFactValue,
} from "@/lib/validations/health-profile-facts";
import {
  parseLifeFactValue,
  type LifeFactKind,
  type LifeFactValue,
  type StoredFactKind,
} from "@/lib/validations/life-circumstances";
import { INSIGHTS_CACHE_CLEARED } from "@/lib/insights/cached-text-cipher";

export interface HealthProfileFactRevisionDto {
  id: string;
  kind: HealthProfileFactKind;
  value: HealthProfileFactValue | null;
  unreadable: boolean;
  validFrom: string;
  validUntil: string | null;
  provenance: "USER_REPORTED" | "USER_CORRECTION";
  supersededByRevisionId: string | null;
  createdAt: string;
}

interface FactRevisionRow {
  id: string;
  kind: StoredFactKind;
  valueEncrypted: Uint8Array;
  validFrom: Date;
  validUntil: Date | null;
  provenance: "USER_REPORTED" | "USER_CORRECTION";
  supersededByRevisionId: string | null;
  createdAt: Date;
}

export interface HealthProfileFactsPayload {
  current: Record<HealthProfileFactKind, HealthProfileFactRevisionDto | null>;
  history: HealthProfileFactRevisionDto[];
}

export interface RemovedHealthProfileFactDto {
  id: string;
  kind: StoredFactKind;
  removedAt: string;
}

/**
 * Clear every cache that can render AI text derived from profile facts.
 * The persisted cache clear also advances User.updatedAt, which is the scope
 * version checked by in-flight insight generation before it can commit.
 */
export async function invalidateHealthProfileFactConsumers(
  userId: string,
  tx: Pick<Prisma.TransactionClient, "user">,
): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: {
      insightsCachedAt: null,
      ...INSIGHTS_CACHE_CLEARED,
      insightsCachedLocale: null,
    },
  });
  invalidateUserInsights(userId);
  // The dashboard's chronotype reads the free-weekday answers (v1.43).
  invalidateUserDashboardSnapshot(userId);
}

export function decryptHealthProfileFactValue(
  kind: HealthProfileFactKind,
  payload: Uint8Array,
): { value: HealthProfileFactValue | null; unreadable: boolean } {
  try {
    const raw = decryptFromBytes(payload).trim();
    if (isHealthProfileFactValue(kind, raw)) {
      return { value: raw, unreadable: false };
    }
    getEvent()?.addWarning(`health profile fact has an invalid ${kind} value`);
  } catch (error) {
    getEvent()?.addWarning(
      `health profile fact decrypt failed (${kind}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { value: null, unreadable: true };
}

export function toHealthProfileFactDto(
  row: FactRevisionRow,
): HealthProfileFactRevisionDto {
  const kind = row.kind as HealthProfileFactKind;
  const decrypted = decryptHealthProfileFactValue(kind, row.valueEncrypted);
  return {
    id: row.id,
    kind,
    value: decrypted.value,
    unreadable: decrypted.unreadable,
    validFrom: row.validFrom.toISOString(),
    validUntil: row.validUntil?.toISOString() ?? null,
    provenance: row.provenance,
    supersededByRevisionId: row.supersededByRevisionId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function readHealthProfileFacts(
  userId: string,
): Promise<HealthProfileFactsPayload> {
  // The three closed kinds only. The table also holds the life-circumstance
  // kinds since v1.43, and older app builds decode this list against exactly
  // three values; those kinds are read through the life-circumstances route.
  const rows = (await prisma.healthProfileFactRevision.findMany({
    where: { userId, kind: { in: [...HEALTH_PROFILE_FACT_KINDS] } },
    orderBy: [{ kind: "asc" }, { validFrom: "desc" }],
    select: {
      id: true,
      kind: true,
      valueEncrypted: true,
      validFrom: true,
      validUntil: true,
      provenance: true,
      supersededByRevisionId: true,
      createdAt: true,
    },
  })) as FactRevisionRow[];

  const history = rows.map(toHealthProfileFactDto);
  const current = Object.fromEntries(
    HEALTH_PROFILE_FACT_KINDS.map((kind) => [
      kind,
      history.find(
        (row) =>
          row.kind === kind &&
          row.validUntil === null &&
          row.supersededByRevisionId === null,
      ) ?? null,
    ]),
  ) as Record<HealthProfileFactKind, HealthProfileFactRevisionDto | null>;

  return { current, history };
}

const FACT_ROW_SELECT = {
  id: true,
  kind: true,
  valueEncrypted: true,
  validFrom: true,
  validUntil: true,
  provenance: true,
  supersededByRevisionId: true,
  createdAt: true,
} as const;

/** The plaintext a fact's ciphertext seals: the closed value, or the life value as JSON. */
function sealFactValue(value: string | LifeFactValue): Uint8Array<ArrayBuffer> {
  return encryptToBytes(
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

/**
 * Open a life-circumstance value and check it against its kind's schema.
 * Fail-closed like the closed kinds: ciphertext this host cannot open, or a
 * value that no longer fits, reads as `unreadable` and never as an answer.
 */
export function decryptLifeFactValue(
  kind: LifeFactKind,
  payload: Uint8Array,
): { value: LifeFactValue | null; unreadable: boolean } {
  try {
    const value = parseLifeFactValue(
      kind,
      JSON.parse(decryptFromBytes(payload)),
    );
    if (value) return { value, unreadable: false };
    getEvent()?.addWarning(`health profile fact has an invalid ${kind} value`);
  } catch (error) {
    getEvent()?.addWarning(
      `health profile fact decrypt failed (${kind}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { value: null, unreadable: true };
}

/**
 * The instant a new answer starts. A requested day later than now is not an
 * answer yet and starts now; one earlier than the end of the kind's previous
 * answer would overlap that interval and starts at its end instead, so the
 * history stays a sequence of half-open intervals.
 */
async function resolveStart(
  tx: Pick<Prisma.TransactionClient, "healthProfileFactRevision">,
  userId: string,
  kind: StoredFactKind,
  requested: Date | undefined,
  now: Date,
): Promise<Date> {
  if (!requested || requested.getTime() >= now.getTime()) return now;
  const previous = await tx.healthProfileFactRevision.findFirst({
    where: { userId, kind, validUntil: { not: null } },
    orderBy: { validUntil: "desc" },
    select: { validUntil: true },
  });
  const floor = previous?.validUntil?.getTime() ?? Number.NEGATIVE_INFINITY;
  return new Date(Math.max(requested.getTime(), floor));
}

async function createFactRevision(
  userId: string,
  kind: StoredFactKind,
  value: string | LifeFactValue,
  now: Date,
  validFrom?: Date,
): Promise<FactRevisionRow> {
  return prisma.$transaction(async (tx) => {
    const start = await resolveStart(tx, userId, kind, validFrom, now);
    const row = (await tx.healthProfileFactRevision.create({
      data: {
        userId,
        kind,
        valueEncrypted: sealFactValue(value),
        validFrom: start,
        provenance: "USER_REPORTED",
      },
      select: FACT_ROW_SELECT,
    })) as FactRevisionRow;
    await invalidateHealthProfileFactConsumers(userId, tx);
    return row;
  });
}

export async function createHealthProfileFact(
  userId: string,
  kind: HealthProfileFactKind,
  value: HealthProfileFactValue,
  now: Date = new Date(),
  validFrom?: Date,
): Promise<HealthProfileFactRevisionDto> {
  return toHealthProfileFactDto(
    await createFactRevision(userId, kind, value, now, validFrom),
  );
}

/** A life-circumstance revision as the life-circumstances read and the fact writes answer it. */
export interface LifeFactRevisionDto {
  id: string;
  kind: "SMOKING_STATUS" | "SHIFT_SCHEDULE" | LifeFactKind;
  value: string | LifeFactValue | null;
  unreadable: boolean;
  validFrom: string;
  validUntil: null;
  provenance: "USER_REPORTED" | "USER_CORRECTION";
  createdAt: string;
}

export function toLifeFactRevisionDto(row: {
  id: string;
  kind: string;
  valueEncrypted: Uint8Array;
  validFrom: Date;
  provenance: "USER_REPORTED" | "USER_CORRECTION";
  createdAt: Date;
}): LifeFactRevisionDto {
  const kind = row.kind as LifeFactRevisionDto["kind"];
  const decrypted =
    kind === "SMOKING_STATUS" || kind === "SHIFT_SCHEDULE"
      ? decryptHealthProfileFactValue(kind, row.valueEncrypted)
      : decryptLifeFactValue(kind, row.valueEncrypted);
  return {
    id: row.id,
    kind,
    value: decrypted.value,
    unreadable: decrypted.unreadable,
    validFrom: row.validFrom.toISOString(),
    validUntil: null,
    provenance: row.provenance,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createLifeFact(
  userId: string,
  kind: LifeFactKind,
  value: LifeFactValue,
  now: Date = new Date(),
  validFrom?: Date,
): Promise<LifeFactRevisionDto> {
  return toLifeFactRevisionDto(
    await createFactRevision(userId, kind, value, now, validFrom),
  );
}

async function correctFactRevision(
  userId: string,
  revisionId: string,
  value: string | LifeFactValue,
  now: Date,
  validFrom?: Date,
): Promise<FactRevisionRow | null> {
  return prisma.$transaction(async (tx) => {
    const current = (await tx.healthProfileFactRevision.findFirst({
      where: {
        id: revisionId,
        userId,
        validUntil: null,
        supersededByRevisionId: null,
      },
      select: FACT_ROW_SELECT,
    })) as FactRevisionRow | null;
    if (!current) return null;

    // The successor starts at the requested day when there is one, never
    // later than now and never at or before the revision it replaces.
    const requested = Math.min(
      validFrom?.getTime() ?? now.getTime(),
      now.getTime(),
    );
    const effectiveAt = new Date(
      Math.max(requested, current.validFrom.getTime() + 1),
    );
    const successorId = randomUUID();
    const closed = await tx.healthProfileFactRevision.updateMany({
      where: {
        id: current.id,
        userId,
        validUntil: null,
        supersededByRevisionId: null,
      },
      data: { validUntil: effectiveAt },
    });
    if (closed.count !== 1) return null;

    const successor = (await tx.healthProfileFactRevision.create({
      data: {
        id: successorId,
        userId,
        kind: current.kind,
        valueEncrypted: sealFactValue(value),
        validFrom: effectiveAt,
        provenance: "USER_CORRECTION",
      },
      select: FACT_ROW_SELECT,
    })) as FactRevisionRow;

    await tx.healthProfileFactRevision.update({
      where: { id: current.id },
      data: { supersededByRevisionId: successor.id },
    });
    await invalidateHealthProfileFactConsumers(userId, tx);

    return successor;
  });
}

export async function correctHealthProfileFact(
  userId: string,
  revisionId: string,
  value: HealthProfileFactValue,
  now: Date = new Date(),
  validFrom?: Date,
): Promise<HealthProfileFactRevisionDto | null> {
  const row = await correctFactRevision(
    userId,
    revisionId,
    value,
    now,
    validFrom,
  );
  return row ? toHealthProfileFactDto(row) : null;
}

export async function correctLifeFact(
  userId: string,
  revisionId: string,
  value: LifeFactValue,
  now: Date = new Date(),
  validFrom?: Date,
): Promise<LifeFactRevisionDto | null> {
  const row = await correctFactRevision(
    userId,
    revisionId,
    value,
    now,
    validFrom,
  );
  return row ? toLifeFactRevisionDto(row) : null;
}

/**
 * Close the current effective interval without deleting or superseding its
 * revision. The closed row remains in dated history, while every current-value
 * consumer excludes it through `validUntil: null`. The revision id is the
 * optimistic token, and the guarded update prevents a stale request from
 * closing a successor.
 */
export async function removeHealthProfileFact(
  userId: string,
  revisionId: string,
  now: Date = new Date(),
): Promise<RemovedHealthProfileFactDto | null> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.healthProfileFactRevision.findFirst({
      where: {
        id: revisionId,
        userId,
        validUntil: null,
        supersededByRevisionId: null,
      },
      select: { id: true, kind: true, validFrom: true },
    });
    if (!current) return null;

    const effectiveAt = new Date(
      Math.max(now.getTime(), current.validFrom.getTime() + 1),
    );
    const closed = await tx.healthProfileFactRevision.updateMany({
      where: {
        id: current.id,
        userId,
        validUntil: null,
        supersededByRevisionId: null,
      },
      data: { validUntil: effectiveAt },
    });
    if (closed.count !== 1) return null;
    await invalidateHealthProfileFactConsumers(userId, tx);

    return {
      id: current.id,
      kind: current.kind as StoredFactKind,
      removedAt: effectiveAt.toISOString(),
    };
  });
}
