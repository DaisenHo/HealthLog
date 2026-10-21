/**
 * What an event does on a channel that carries no stored preference row.
 *
 * Most events have a constant answer (`EVENT_DEFAULT_ENABLED`). One does not:
 * the mood reminder has no switch of its own at the channel layer, it follows
 * the reminder card (`User.moodReminderEnabled`). The dispatcher has resolved
 * it that way since v1.7.0, while the `/notifications` matrix read the
 * constant table and showed the reminder as off on every channel of an account
 * that was receiving it.
 *
 * This module is the one answer both read. The dispatcher asks per event, the
 * preferences read publishes the whole map as `eventDefaults`, and a client
 * renders that map instead of keeping a copy of the table — so the switch a
 * person reads and the delivery they get cannot disagree again.
 */
import { prisma } from "@/lib/db";
import {
  EVENT_DEFAULT_ENABLED,
  EVENT_TYPES,
  type EventType,
} from "@/lib/notifications/types";

/** The account settings a default can follow. */
export interface EventDefaultInputs {
  moodReminderEnabled: boolean;
}

/**
 * The events whose default is read off the account rather than the constant
 * table. Kept as a map so the account read below happens only for them.
 */
const ACCOUNT_DERIVED: Partial<
  Record<EventType, (inputs: EventDefaultInputs) => boolean>
> = {
  MOOD_REMINDER: (inputs) => inputs.moodReminderEnabled,
};

function isEventType(value: string): value is EventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** The no-row default for one event, given the account's settings. */
export function eventDefaultFor(
  eventType: string,
  inputs: EventDefaultInputs,
): boolean {
  if (!isEventType(eventType)) return true;
  const derived = ACCOUNT_DERIVED[eventType];
  return derived ? derived(inputs) : EVENT_DEFAULT_ENABLED[eventType];
}

/** Every event's no-row default, given the account's settings. */
export function eventDefaultsFor(
  inputs: EventDefaultInputs,
): Record<EventType, boolean> {
  return Object.fromEntries(
    EVENT_TYPES.map((eventType) => [
      eventType,
      eventDefaultFor(eventType, inputs),
    ]),
  ) as Record<EventType, boolean>;
}

async function readInputs(userId: string): Promise<EventDefaultInputs> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { moodReminderEnabled: true },
  });
  return { moodReminderEnabled: user?.moodReminderEnabled === true };
}

/**
 * The dispatcher's question. Reads the account only for an event whose
 * default follows it, so the common event types pay nothing.
 */
export async function resolveEventDefault(
  userId: string,
  eventType: string,
): Promise<boolean> {
  if (!isEventType(eventType)) return true;
  const derived = ACCOUNT_DERIVED[eventType];
  return derived
    ? derived(await readInputs(userId))
    : EVENT_DEFAULT_ENABLED[eventType];
}

/** The preferences read's answer: the whole map for one account. */
export async function resolveEventDefaults(
  userId: string,
): Promise<Record<EventType, boolean>> {
  return eventDefaultsFor(await readInputs(userId));
}
