/**
 * What a medication route leaves in the database, read back for a parity
 * snapshot (see `tests/kit/parity.ts`).
 *
 * Whole rows, not a hand-picked select: a parity snapshot is meant to notice
 * a column the moved code stops writing, and a select names only the columns
 * somebody thought of. Two kinds of value are rewritten before the snapshot
 * sees them, because their bytes differ between two runs of the same code:
 * ciphertext (a fresh IV per write) reads as `<bytes>` or `<ciphertext>`, and
 * a Prisma `Decimal` reads as its decimal string.
 *
 * Rows come back in an order decided by their content with generated ids
 * blanked, never by the ids themselves, so two runs list them alike.
 */
import { Prisma, type User } from "@/generated/prisma/client";
import type { AccountGrantAccess } from "@/generated/prisma/enums";

import { expect } from "vitest";

import { callRoute, type CallRouteOptions } from "../../../kit/call-route";
import type { SessionFixture } from "../../../kit/factories";
import { makeGrant, makeSession, makeUser } from "../../../kit/factories";
import {
  effectRecorder,
  eventFacts,
  expectParity,
  stable,
  wideEventRecorder,
} from "../../../kit/parity";
import { getPrismaClient } from "../../setup";

type Client = ReturnType<typeof getPrismaClient>;

/**
 * A second account holding a grant of `access` over `owner`'s record, with
 * its session switched onto that record and the headers a switched browser
 * sends with every request.
 */
export async function delegateOf(
  prisma: Client,
  owner: Pick<User, "id">,
  access: AccountGrantAccess,
): Promise<{
  delegate: User;
  auth: SessionFixture;
  headers: Record<string, string>;
}> {
  const delegate = await makeUser({ timezone: "UTC" });
  await makeGrant(owner, delegate, { access });
  const auth = await makeSession(delegate);
  const switched = await prisma.session.update({
    where: { id: auth.sessionId },
    data: { actingAsUserId: owner.id },
  });
  return {
    delegate,
    auth,
    headers: {
      "x-healthlog-record-epoch": String(switched.recordEpoch),
      "x-healthlog-record-scope": owner.id,
    },
  };
}

const GENERATED_ID =
  /^(c[a-z0-9]{24}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** Audit rows the record guard writes without awaiting them. */
const GUARD_TRAIL_ACTIONS = [
  "sharing.record.accessed",
  "sharing.access.denied",
] as const;
const ORDER_BLIND_KEYS = new Set(["createdAt", "updatedAt", "syncVersion"]);

/** A copy with ciphertext and decimals replaced by stable stand-ins. */
export function plain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value;
  if (Prisma.Decimal.isDecimal(value)) return value.toString();
  if (value instanceof Uint8Array) return "<bytes>";
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = /Encrypted$/.test(k) && v !== null ? "<ciphertext>" : plain(v);
    }
    return out;
  }
  return value;
}

function orderKey(value: unknown): string {
  return JSON.stringify(value, (key, v: unknown) => {
    if (ORDER_BLIND_KEYS.has(key)) return undefined;
    if (typeof v === "string" && GENERATED_ID.test(v)) return "";
    return v;
  });
}

/** Rows in content order, ids and stamps left out of the comparison. */
export function sortRows<T>(rows: readonly T[]): unknown[] {
  return rows
    .map(plain)
    .map((row) => ({ row, key: orderKey(row) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map(({ row }) => row);
}

/**
 * Every medication table a medication route writes, for the given accounts,
 * plus the audit trail and the idempotency cache. The rows the record guard
 * writes about a delegate (the day's access row, a refusal) are left out: the
 * guard writes them fire-and-forget, so whether one has landed when the test
 * reads is a race, not something the route decides.
 */
export async function medicationState(prisma: Client, userIds: string[]) {
  const byUser = { userId: { in: userIds } };
  const byMedication = { medication: byUser };
  const [
    medications,
    schedules,
    revisions,
    pauseEras,
    courses,
    intakes,
    doseChanges,
    inventoryItems,
    inventoryEvents,
    categories,
    ingredients,
    audit,
    idempotency,
  ] = await Promise.all([
    prisma.medication.findMany({ where: byUser }),
    prisma.medicationSchedule.findMany({ where: byMedication }),
    prisma.medicationScheduleRevision.findMany({ where: byMedication }),
    prisma.medicationPauseEra.findMany({ where: byMedication }),
    prisma.medicationCourse.findMany({ where: byMedication }),
    prisma.medicationIntakeEvent.findMany({ where: byUser }),
    prisma.medicationDoseChange.findMany({ where: byMedication }),
    prisma.medicationInventoryItem.findMany({ where: byUser }),
    prisma.medicationInventoryEvent.findMany({ where: byMedication }),
    prisma.medicationCategoryAssignment.findMany({ where: byMedication }),
    prisma.medicationIngredient.findMany({ where: byMedication }),
    prisma.auditLog.findMany({
      where: { ...byUser, action: { notIn: [...GUARD_TRAIL_ACTIONS] } },
      select: {
        action: true,
        userId: true,
        actorUserId: true,
        details: true,
        ipAddress: true,
      },
    }),
    prisma.idempotencyKey.findMany({
      where: byUser,
      select: {
        userId: true,
        key: true,
        method: true,
        path: true,
        responseStatus: true,
        requestFingerprint: true,
        expiresAt: true,
      },
    }),
  ]);
  return {
    medications: sortRows(medications),
    schedules: sortRows(schedules),
    revisions: sortRows(revisions),
    pauseEras: sortRows(pauseEras),
    courses: sortRows(courses),
    intakes: sortRows(intakes),
    doseChanges: sortRows(doseChanges),
    inventoryItems: sortRows(inventoryItems),
    inventoryEvents: sortRows(inventoryEvents),
    categories: sortRows(categories),
    ingredients: sortRows(ingredients),
    audit: sortRows(
      audit.map((row) => ({
        ...row,
        details: row.details ? (JSON.parse(row.details) as unknown) : null,
      })),
    ),
    idempotency: sortRows(idempotency),
  };
}

/**
 * A server cache reports the hash of the key it looked up, and the key holds
 * the account id, so the hash differs on every run. Its presence is kept.
 */
function withoutCacheKeyHashes(facts: unknown): unknown {
  if (!facts || typeof facts !== "object") return facts;
  const { meta } = facts as { meta?: unknown };
  if (!meta || typeof meta !== "object") return facts;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    cleaned[k] = /^cache\..+\.key_hash$/.test(k) ? "<key_hash>" : v;
  }
  return { ...facts, meta: cleaned };
}

export interface ParityCall {
  /** Snapshot name, `<route>.<case>`. */
  name: string;
  handler: Parameters<typeof callRoute>[0];
  options: CallRouteOptions;
  /** Accounts whose rows the snapshot reads back. */
  userIds: string[];
  /** The clock the test pinned; server stamps at or after it read `<now>`. */
  now: Date;
}

/**
 * One request and everything it decided: the response, the wide event, the
 * recorded tails and the rows read back afterwards, compared with the
 * committed snapshot. Returns the response for a test that needs an id from
 * it for the next case.
 */
export async function parityStep(call: ParityCall) {
  wideEventRecorder.take();
  effectRecorder.take();
  const res = await callRoute(call.handler, call.options);
  const events = wideEventRecorder.take();
  expect(events.length).toBeGreaterThan(0);
  await expectParity(
    call.name,
    stable(
      {
        status: res.status,
        body: res.body,
        events: events.map(eventFacts).map(withoutCacheKeyHashes),
        effects: effectRecorder.take(),
        stored: await medicationState(getPrismaClient(), call.userIds),
      },
      { since: call.now },
    ),
  );
  return res;
}
