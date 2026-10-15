/**
 * The integration watchdog and the connection health read against real
 * Postgres: the 14-day history count, the one-alert-per-incident ledger, the
 * recovery note, the on-demand exemption, the adoption of a page the sync
 * ledger already sent, and the recent-call ring the diagnostics read.
 *
 * The dispatcher is mocked: what is asserted is how many operator messages
 * the watchdog asks for, not their delivery.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { getPrismaClient, truncateAllTables } from "./setup";

vi.mock("@/lib/db-compat", () => ({
  ensureDbCompatibility: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/notifications/dispatcher", () => ({
  dispatchNotification: vi.fn().mockResolvedValue({
    dispatched: true,
    channelsAttempted: 1,
    channelsSucceeded: 1,
  }),
}));

import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { runIntegrationWatchdog } from "@/lib/integrations/watchdog";
import { loadConnectionHealth } from "@/lib/integrations/connection-health-load";
import {
  recordSyncFailure,
  recordSyncSuccess,
} from "@/lib/integrations/status";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-15T12:00:00.000Z");
const USER = "user-watchdog-subject";
const ADMIN = "user-watchdog-admin";

const prisma = () => getPrismaClient();

async function seedDailyReadings(
  userId: string,
  source: "OURA" | "WITHINGS",
  days: number[],
  newestHoursAgo: number,
) {
  const rows = days.map((d) => ({
    userId,
    type: "RESTING_HEART_RATE" as const,
    value: 60,
    unit: "bpm",
    source,
    measuredAt: new Date(NOW.getTime() - d * DAY - 6 * HOUR),
  }));
  rows.push({
    userId,
    type: "RESTING_HEART_RATE" as const,
    value: 60,
    unit: "bpm",
    source,
    measuredAt: new Date(NOW.getTime() - newestHoursAgo * HOUR),
  });
  await prisma().measurement.createMany({ data: rows });
}

function dispatchedTitles(): string[] {
  return vi
    .mocked(dispatchNotification)
    .mock.calls.map((c) => String((c[0] as { title: string }).title));
}

beforeEach(async () => {
  await truncateAllTables(prisma());
  await prisma().user.create({
    data: {
      id: ADMIN,
      username: "wd-admin",
      email: "admin@example.test",
      role: "ADMIN",
    },
  });
  await prisma().user.create({
    data: {
      id: USER,
      username: "wd-subject",
      email: "subject@example.test",
      ouraAccessTokenEncrypted: "not-a-real-token",
    },
  });
  vi.mocked(dispatchNotification).mockClear();
});

describe("integration watchdog", () => {
  it("flags a normally-daily wearable gone silent, alerts once, then sends one recovery note", async () => {
    // Fourteen consecutive days of data before the window, newest 30 h ago.
    await seedDailyReadings(
      USER,
      "OURA",
      Array.from({ length: 13 }, (_, i) => i + 2),
      30,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      await recordSyncSuccess(USER, "oura");

      const first = await runIntegrationWatchdog({ mode: "hourly", now: NOW });
      expect(first.silencesFlagged).toBe(1);
      expect(first.incidentsOpened).toBe(1);
      expect(dispatchedTitles()).toEqual([
        "Oura needs attention for subject@example.test",
      ]);

      const watch = await prisma().integrationWatch.findUniqueOrThrow({
        where: { userId_integration: { userId: USER, integration: "oura" } },
      });
      expect(watch.incidentReason).toBe("unexpected_silence");
      expect(watch.silentSince).not.toBeNull();
      expect(watch.alertedAt).not.toBeNull();

      const health = await loadConnectionHealth(USER, ["oura"]);
      expect(health.oura?.state).toBe("degraded");
      expect(health.oura?.reason).toBe("unexpected_silence");

      // Next hour, and the daily pass: still silent, nothing new is sent.
      const later = new Date(NOW.getTime() + HOUR);
      await runIntegrationWatchdog({ mode: "hourly", now: later });
      await runIntegrationWatchdog({ mode: "daily", now: later });
      expect(dispatchNotification).toHaveBeenCalledTimes(1);

      // Data arrives again: the incident closes with one recovery note.
      await prisma().measurement.create({
        data: {
          userId: USER,
          type: "RESTING_HEART_RATE",
          value: 61,
          unit: "bpm",
          source: "OURA",
          measuredAt: new Date(later.getTime() - 10 * 60 * 1000),
        },
      });
      const recovered = await runIntegrationWatchdog({
        mode: "hourly",
        now: new Date(later.getTime() + HOUR),
      });
      expect(recovered.incidentsClosed).toBe(1);
      expect(dispatchedTitles()).toEqual([
        "Oura needs attention for subject@example.test",
        "Oura recovered for subject@example.test",
      ]);
      const cleared = await prisma().integrationWatch.findUniqueOrThrow({
        where: { userId_integration: { userId: USER, integration: "oura" } },
      });
      expect(cleared.silentSince).toBeNull();
      expect(cleared.incidentReason).toBeNull();

      // Healthy and quiet: further passes send nothing.
      await runIntegrationWatchdog({
        mode: "hourly",
        now: new Date(later.getTime() + 2 * HOUR),
      });
      expect(dispatchNotification).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a wearable alone when its owner wears it only now and then", async () => {
    await seedDailyReadings(USER, "OURA", [3, 7, 11], 30);
    await recordSyncSuccess(USER, "oura");
    const summary = await runIntegrationWatchdog({ mode: "hourly", now: NOW });
    expect(summary.silencesFlagged).toBe(0);
    expect(dispatchNotification).not.toHaveBeenCalled();
    expect(await prisma().integrationWatch.count()).toBe(0);
  });

  it("never alerts on silence for an on-demand source such as a scale", async () => {
    await prisma().user.update({
      where: { id: USER },
      data: { ouraAccessTokenEncrypted: null },
    });
    await prisma().withingsConnection.create({
      data: {
        userId: USER,
        withingsUserId: "w-1",
        accessToken: "x",
        refreshToken: "y",
        tokenExpiresAt: new Date(NOW.getTime() + DAY),
        scope: "user.metrics,user.activity",
      },
    });
    // Daily weigh-ins for two weeks, then nothing for three days.
    await seedDailyReadings(
      USER,
      "WITHINGS",
      Array.from({ length: 13 }, (_, i) => i + 4),
      72,
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      await recordSyncSuccess(USER, "withings");
      const summary = await runIntegrationWatchdog({ mode: "daily", now: NOW });
      expect(summary.connectionsConsidered).toBe(1);
      expect(summary.silencesFlagged).toBe(0);
      expect(dispatchNotification).not.toHaveBeenCalled();
      const health = await loadConnectionHealth(USER, ["withings"]);
      expect(health.withings?.state).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("adopts a failure streak the ledger already paged about and reports its end once", async () => {
    await seedDailyReadings(USER, "OURA", [2], 5);
    for (let i = 0; i < 3; i++) {
      await recordSyncFailure({
        userId: USER,
        integration: "oura",
        kind: "transient",
        message: "Oura error: 503 with a body that must never be published",
        errorCode: "503",
      });
    }
    // The ledger's own 3-strike page.
    expect(dispatchNotification).toHaveBeenCalledTimes(1);

    const now = new Date();
    const adopted = await runIntegrationWatchdog({ mode: "hourly", now });
    expect(adopted.incidentsOpened).toBe(1);
    expect(dispatchNotification).toHaveBeenCalledTimes(1);

    await recordSyncSuccess(USER, "oura");
    const closed = await runIntegrationWatchdog({ mode: "hourly", now });
    expect(closed.incidentsClosed).toBe(1);
    expect(dispatchNotification).toHaveBeenCalledTimes(2);
    expect(dispatchedTitles()[1]).toBe(
      "Oura recovered for subject@example.test",
    );
  });
});

describe("recent-call ring", () => {
  it("keeps the newest ten attempts, newest first, without any message text", async () => {
    for (let i = 0; i < 7; i++) {
      await recordSyncFailure({
        userId: USER,
        integration: "oura",
        kind: "transient",
        message: `secret-bearing upstream body ${i}`,
        errorCode: i === 6 ? "token=abc def" : "503",
        leg: "sleep",
      });
    }
    for (let i = 0; i < 5; i++) {
      await recordSyncSuccess(USER, "oura", { leg: "sleep" });
    }
    const row = await prisma().integrationStatus.findUniqueOrThrow({
      where: { userId_integration: { userId: USER, integration: "oura" } },
    });
    const calls = row.recentCalls as Array<Record<string, unknown>>;
    expect(calls).toHaveLength(10);
    expect(calls.slice(0, 5).every((c) => c.status === "ok")).toBe(true);
    expect(calls[5]).toMatchObject({
      endpoint: "sleep",
      status: "transient",
      errorCode: null,
    });
    expect(calls[6]).toMatchObject({ errorCode: "503" });
    expect(JSON.stringify(calls)).not.toContain("secret");

    const health = await loadConnectionHealth(USER, ["oura"]);
    expect(health.oura?.diagnostics.recentCalls).toHaveLength(10);
    expect(JSON.stringify(health.oura)).not.toContain(USER);
  });
});
