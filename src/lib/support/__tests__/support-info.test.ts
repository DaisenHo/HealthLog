import { describe, expect, it } from "vitest";

import { buildSupportInfo, type SupportInfoInput } from "../support-info";

const ERROR_ID = "3f9a2c1b-0000-4000-8000-000000000001";

function input(over: Partial<SupportInfoInput> = {}): SupportInfoInput {
  return {
    version: { version: "1.43.0", buildSha: "abc1234" },
    me: {
      id: "cmuserabcdefghijklmnopqr",
      username: "distinctuser",
      email: "distinct.user@example.org",
      fullName: "Dora Distinct",
      timezone: "Europe/Berlin",
      modules: { mood: true, sleep: true, cycle: false },
      ai: {
        capabilities: {
          coach: { available: false, reason: "not_granted" },
          briefing: { available: true, reason: null },
        },
        provider: { configured: true, managedBy: "server" },
        usage: { level: "STANDARD" },
      },
    },
    locale: "de",
    connections: [
      { integration: "polar", connected: false, health: null },
      {
        integration: "withings",
        connected: true,
        health: {
          state: "degraded",
          reason: "provider_errors",
          since: "2026-10-14T08:00:00.000Z",
          action: null,
          unavailable: [{ item: "spo2", cause: "plan" }],
          lastSuccessAt: "2026-10-14T07:00:00.000Z",
          lastDataAt: "2026-10-14T06:00:00.000Z",
          diagnostics: {
            ledgerState: "failing",
            failingLegs: ["sleep"],
            failingSince: "2026-10-14T08:00:00.000Z",
            lastAttemptAt: "2026-10-15T08:00:00.000Z",
            verdict: "stale",
            recentCalls: [
              {
                endpoint: "sleep",
                status: "transient",
                at: "2026-10-15T08:00:00.000Z",
                errorCode: "503",
              },
            ],
          },
        },
      },
    ],
    recentErrorIds: [ERROR_ID],
    client: {
      userAgent:
        "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
      standalone: true,
    },
    generatedAt: "2026-10-15T10:00:00.000Z",
    ...over,
  } as SupportInfoInput;
}

describe("buildSupportInfo", () => {
  it("carries build, account settings, AI state, health and error ids", () => {
    const text = buildSupportInfo(input());
    expect(text).toContain("- Server version: 1.43.0");
    expect(text).toContain("- Build SHA: abc1234");
    expect(text).toContain("- Client: web (installed app)");
    expect(text).toContain("Chrome/128.0.0.0");
    expect(text).toContain("- Language: de");
    expect(text).toContain("- Time zone: Europe/Berlin");
    expect(text).toContain("- Enabled modules: mood, sleep");
    expect(text).toContain("- Usage level: STANDARD");
    expect(text).toContain("- coach: unavailable (not_granted)");
    expect(text).toContain(
      "- withings: degraded / provider_errors since 2026-10-14T08:00:00.000Z",
    );
    expect(text).toContain("Unavailable: spo2 (plan)");
    expect(text).toContain("2026-10-15T08:00:00.000Z sleep: transient (503)");
    expect(text).not.toContain("polar");
    // The person's own error ids survive the id-shaped scrub.
    expect(text).toContain(`- ${ERROR_ID}`);
  });

  it("never carries the username, email, name or account id", () => {
    const text = buildSupportInfo(input());
    for (const value of [
      "cmuserabcdefghijklmnopqr",
      "distinctuser",
      "distinct.user@example.org",
      "Dora Distinct",
    ]) {
      expect(text.toLowerCase()).not.toContain(value.toLowerCase());
    }
  });

  it("redacts an account value that turns up in a field it should not", () => {
    const text = buildSupportInfo(
      input({
        me: {
          ...input().me!,
          timezone: "distinct.user@example.org",
        },
      }),
    );
    expect(text).not.toContain("distinct.user@example.org");
  });

  it("says what it could not load rather than guessing", () => {
    const text = buildSupportInfo(
      input({ version: null, connections: null, recentErrorIds: [] }),
    );
    expect(text).toContain("- Server version: unknown");
    expect(text).toContain("## Connections\n- Not loaded");
    expect(text).toContain("## Recent error ids (this session)\n- None");
  });
});
