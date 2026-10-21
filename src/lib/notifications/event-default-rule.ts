/**
 * The no-row default rule itself, without the account read: client-safe, so
 * a screen that has to stand in for a missing server answer applies the same
 * rule instead of a copy of the table (`./event-defaults` reads the account
 * and calls this).
 */
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
export const ACCOUNT_DERIVED: Partial<
  Record<EventType, (inputs: EventDefaultInputs) => boolean>
> = {
  MOOD_REMINDER: (inputs) => inputs.moodReminderEnabled,
};

export function isEventType(value: string): value is EventType {
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

/**
 * Whether the matrix shows `eventType` on `channelId` as on: the stored row
 * when there is one, else the server's resolved default for the account. A
 * payload without `eventDefaults` (a response cached by a build before the
 * field) falls back to this rule rather than to all-off; the mood reminder,
 * whose default follows an account setting the screen does not hold, reads
 * off until the server answers.
 */
export function preferenceCellEnabled(
  data:
    | {
        preferences?: ReadonlyArray<{
          channelId: string;
          eventType: string;
          enabled: boolean;
        }>;
        eventDefaults?: Partial<Record<string, boolean>>;
      }
    | undefined,
  channelId: string,
  eventType: string,
): boolean {
  const pref = data?.preferences?.find(
    (p) => p.channelId === channelId && p.eventType === eventType,
  );
  if (pref) return pref.enabled;
  const resolved = data?.eventDefaults?.[eventType];
  if (typeof resolved === "boolean") return resolved;
  return eventDefaultFor(eventType, { moodReminderEnabled: false });
}
