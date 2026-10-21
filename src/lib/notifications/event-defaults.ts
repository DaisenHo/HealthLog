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
  ACCOUNT_DERIVED,
  eventDefaultsFor,
  isEventType,
  type EventDefaultInputs,
} from "@/lib/notifications/event-default-rule";
import {
  EVENT_DEFAULT_ENABLED,
  type EventType,
} from "@/lib/notifications/types";

export {
  eventDefaultFor,
  eventDefaultsFor,
} from "@/lib/notifications/event-default-rule";

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
