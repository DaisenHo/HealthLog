import { AsyncLocalStorage } from "node:async_hooks";
import type { WideEvent } from "./types";
import { WideEventBuilder } from "./event-builder";
import { registerSourcePriorityParseObserver } from "@/lib/validations/source-priority";
import {
  DATETIME_NO_SECONDS_COUNTER,
  registerDatetimeNoSecondsObserver,
} from "@/lib/validations/datetime";

/** AsyncLocalStorage fuer den aktuellen Request-Kontext */
export const eventStorage = new AsyncLocalStorage<WideEventBuilder>();

/** Aktuellen EventBuilder abrufen (null falls ausserhalb eines Kontexts) */
export function getEvent(): WideEventBuilder | null {
  return eventStorage.getStore() ?? null;
}

/**
 * Convenience: Felder im aktuellen Event annotieren.
 * Safe to call anywhere — no-op wenn kein Kontext aktiv.
 */
export function annotate(fields: {
  action?: WideEvent["action"];
  meta?: Record<string, unknown>;
}): void {
  const evt = getEvent();
  if (!evt) return;
  if (fields.action) evt.setAction(fields.action);
  if (fields.meta) {
    for (const [key, value] of Object.entries(fields.meta)) {
      evt.addMeta(key, value);
    }
  }
}

// v1.4.25 Fix-G — wire the schema-parser breadcrumb into the
// AsyncLocalStorage-backed `annotate()` only on the server. The
// validations module stays bundle-safe for client imports; this side
// effect runs the first time any server module imports the logging
// context.
registerSourcePriorityParseObserver((fields) => {
  annotate(fields);
});

// v1.43 — count every request instant refused for lacking seconds, per wide
// event, so a client still on a minute-precision encoder is visible in the
// logs (`meta["validation.datetime.no_seconds"]`) before its users report
// the 422. Same bundle-safe registration as the breadcrumb above.
const noSecondsCounts = new WeakMap<WideEventBuilder, number>();
registerDatetimeNoSecondsObserver(() => {
  const evt = getEvent();
  if (!evt) return;
  const next = (noSecondsCounts.get(evt) ?? 0) + 1;
  noSecondsCounts.set(evt, next);
  evt.addMeta(DATETIME_NO_SECONDS_COUNTER, next);
});
