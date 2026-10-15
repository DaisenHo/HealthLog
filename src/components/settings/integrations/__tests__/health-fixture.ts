import type { ConnectionHealth } from "@/lib/integrations/connection-health";

/** A `ConnectionHealth` as the server would publish it, with overrides. */
export function healthFixture(
  overrides: Partial<ConnectionHealth> = {},
): ConnectionHealth {
  return {
    state: "ok",
    reason: "data_arriving",
    since: null,
    action: null,
    unavailable: [],
    lastSuccessAt: "2026-10-15T08:12:00.000Z",
    lastDataAt: "2026-10-15T07:12:00.000Z",
    diagnostics: {
      ledgerState: "connected",
      failingLegs: [],
      failingSince: null,
      lastAttemptAt: "2026-10-15T08:12:00.000Z",
      verdict: "fresh",
      recentCalls: [],
    },
    ...overrides,
  };
}
