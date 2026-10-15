import { describe, expect, it } from "vitest";
import {
  readRecentCalls,
  resolveConnectionHealth,
  safeErrorCode,
  type ConnectionHealthInput,
} from "../connection-health";
import type { SyncHealth } from "../sync-verdict";

const NOW = Date.parse("2026-10-15T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function input(
  verdict: SyncHealth["verdict"],
  extra: Partial<ConnectionHealthInput> = {},
): ConnectionHealthInput {
  return {
    syncHealth: {
      verdict,
      since: verdict === "fresh" ? null : "2026-10-14T08:00:00.000Z",
    },
    connected: true,
    ledgerState: "connected",
    lastSuccessAt: "2026-10-15T11:00:00.000Z",
    lastAttemptAt: "2026-10-15T11:00:00.000Z",
    failingSince: null,
    failingLegs: [],
    recentCalls: [],
    lastDataAt: "2026-10-15T10:00:00.000Z",
    silenceWindowMs: 24 * HOUR,
    now: NOW,
    ...extra,
  };
}

describe("resolveConnectionHealth", () => {
  it("returns null for a connection that does not exist", () => {
    expect(
      resolveConnectionHealth(input("fresh", { connected: false })),
    ).toBeNull();
    expect(resolveConnectionHealth(input("disconnected"))).toBeNull();
  });

  it("maps a fresh verdict to ok / data_arriving", () => {
    const h = resolveConnectionHealth(input("fresh"))!;
    expect(h.state).toBe("ok");
    expect(h.reason).toBe("data_arriving");
    expect(h.action).toBeNull();
    expect(h.since).toBeNull();
  });

  it("maps a pending first sync to ok / first_sync_pending, not to a problem", () => {
    const h = resolveConnectionHealth(input("pending_first_sync"))!;
    expect(h.state).toBe("ok");
    expect(h.reason).toBe("first_sync_pending");
  });

  it.each([
    ["reauth_required", "reauth_required", "reconnect"],
    ["parked", "paused_after_errors", "resume"],
  ] as const)(
    "maps %s to action_required with exactly one action",
    (verdict, reason, action) => {
      const h = resolveConnectionHealth(input(verdict))!;
      expect(h.state).toBe("action_required");
      expect(h.reason).toBe(reason);
      expect(h.action).toBe(action);
      expect(h.since).toBe("2026-10-14T08:00:00.000Z");
    },
  );

  it("treats a provider-side reauth flag as action_required even on a fresh ledger", () => {
    const h = resolveConnectionHealth(input("fresh", { needsReauth: true }))!;
    expect(h.state).toBe("action_required");
    expect(h.action).toBe("reconnect");
  });

  it.each([
    ["failing", "provider_errors"],
    ["stalled", "sync_stalled"],
    ["stale", "no_new_data"],
  ] as const)("maps %s to degraded / %s, no action", (verdict, reason) => {
    const h = resolveConnectionHealth(input(verdict))!;
    expect(h.state).toBe("degraded");
    expect(h.reason).toBe(reason);
    expect(h.action).toBeNull();
    expect(h.since).not.toBeNull();
  });

  it("lists plan-withheld types as limited without an action", () => {
    const h = resolveConnectionHealth(
      input("fresh", { planUnavailable: ["spo2", "ecg", "spo2"] }),
    )!;
    expect(h.state).toBe("limited");
    expect(h.reason).toBe("plan_limited");
    expect(h.action).toBeNull();
    expect(h.unavailable).toEqual([
      { item: "spo2", cause: "plan" },
      { item: "ecg", cause: "plan" },
    ]);
  });

  it("offers one reconnect when a permission gap is part of the limit", () => {
    const h = resolveConnectionHealth(
      input("fresh", {
        planUnavailable: ["ecg"],
        permissionUnavailable: ["spo2"],
      }),
    )!;
    expect(h.state).toBe("limited");
    expect(h.reason).toBe("permission_limited");
    expect(h.action).toBe("reconnect");
  });

  it("lets a worse state win over limited, keeping the unavailable list", () => {
    const h = resolveConnectionHealth(
      input("failing", { planUnavailable: ["ecg"] }),
    )!;
    expect(h.state).toBe("degraded");
    expect(h.unavailable).toEqual([{ item: "ecg", cause: "plan" }]);
  });

  it("surfaces the watchdog silence flag as degraded / unexpected_silence", () => {
    const h = resolveConnectionHealth(
      input("fresh", {
        lastDataAt: "2026-10-13T12:00:00.000Z",
        silentSince: "2026-10-13T12:00:00.000Z",
      }),
    )!;
    expect(h.state).toBe("degraded");
    expect(h.reason).toBe("unexpected_silence");
    expect(h.since).toBe("2026-10-13T12:00:00.000Z");
  });

  it("drops a stale silence flag as soon as fresh data has arrived", () => {
    const h = resolveConnectionHealth(
      input("fresh", {
        lastDataAt: "2026-10-15T11:30:00.000Z",
        silentSince: "2026-10-13T12:00:00.000Z",
      }),
    )!;
    expect(h.state).toBe("ok");
  });

  it("lets a reauth outrank the silence flag", () => {
    const h = resolveConnectionHealth(
      input("reauth_required", {
        lastDataAt: "2026-10-13T12:00:00.000Z",
        silentSince: "2026-10-13T12:00:00.000Z",
      }),
    )!;
    expect(h.state).toBe("action_required");
  });
});

describe("recent-call diagnostics", () => {
  it("keeps only closed-shape codes", () => {
    expect(safeErrorCode("401")).toBe("401");
    expect(safeErrorCode("invalid_grant")).toBe("invalid_grant");
    expect(safeErrorCode("Bearer abc def")).toBeNull();
    expect(safeErrorCode("https://host/api?token=x")).toBeNull();
    expect(safeErrorCode(null)).toBeNull();
  });

  it("reads well-formed entries and drops anything carrying free text", () => {
    const calls = readRecentCalls([
      {
        endpoint: "sleep",
        status: "transient",
        at: "2026-10-15T10:00:00Z",
        errorCode: "503",
        message: "upstream said something with a token",
      },
      {
        endpoint: "https://evil/?t=1",
        status: "ok",
        at: "2026-10-15T09:00:00Z",
        errorCode: "token=secret value",
      },
      { endpoint: "sleep", status: "exploded", at: "2026-10-15T08:00:00Z" },
      "not an object",
    ]);
    expect(calls).toEqual([
      {
        endpoint: "sleep",
        status: "transient",
        at: "2026-10-15T10:00:00.000Z",
        errorCode: "503",
      },
      {
        endpoint: "sync",
        status: "ok",
        at: "2026-10-15T09:00:00.000Z",
        errorCode: null,
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain("token");
  });

  it("caps the published list at ten", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      endpoint: "sync",
      status: "ok",
      at: new Date(NOW - i * HOUR).toISOString(),
      errorCode: null,
    }));
    expect(readRecentCalls(many)).toHaveLength(10);
  });
});
