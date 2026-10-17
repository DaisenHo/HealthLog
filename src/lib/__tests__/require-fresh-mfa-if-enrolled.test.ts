import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirror require-fresh-mfa.test.ts mocking so the api-handler module loads
// without a live DB / request scope.
vi.mock("@/lib/db", () => ({
  prisma: {
    session: { findUnique: vi.fn() },
    apiToken: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn() },
    webauthnMfaCredential: { count: vi.fn() },
    // The stale refusal names the proofs the account holds, passkeys among them.
    passkey: { count: vi.fn() },
  },
}));

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth/hmac", () => ({ hashToken: vi.fn(() => "hash") }));
vi.mock("@/lib/auth/audit", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logging/transports", () => ({ emitIfSampled: vi.fn() }));

const headersGet = vi.fn<(name: string) => string | null>();
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGet })),
  cookies: vi.fn(async () => ({
    get: () => undefined,
    set: () => {},
    delete: () => {},
  })),
}));

import {
  requireFreshMfaIfEnrolled,
  StepUpRequiredError,
  HttpError,
  MFA_STEP_UP_MAX_AGE_SECONDS,
} from "../api-handler";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { headers } from "next/headers";
import { auditLog } from "@/lib/auth/audit";

const MFA_USER = {
  id: "user-1",
  role: "USER" as const,
  username: "u",
  totpConfirmedAt: new Date("2020-01-01"),
};
const PLAIN_USER = { ...MFA_USER, totpConfirmedAt: null };

beforeEach(() => {
  vi.resetAllMocks();
  headersGet.mockReturnValue(null);
  // resetAllMocks wipes the inline mock factory implementation too; restore
  // the headers() wrapper so requireAuth's Bearer branch can read the header.
  vi.mocked(headers).mockImplementation(
    async () => ({ get: headersGet }) as never,
  );
  // resetAllMocks wipes the factory mockResolvedValue; auditLog is awaited
  // via `.catch(...)` in the Bearer path, so it must return a thenable.
  vi.mocked(auditLog).mockResolvedValue(undefined);
  // Default: no registered security key, so a TOTP-less account is genuinely
  // unenrolled and passes straight through.
  vi.mocked(prisma.webauthnMfaCredential.count).mockResolvedValue(0 as never);
});

function mockCookieSession(user: unknown) {
  vi.mocked(getSession).mockResolvedValue({
    session: { id: "sess-1", expiresAt: new Date(Date.now() + 1e6) },
    user,
  } as never);
}

describe("requireFreshMfaIfEnrolled", () => {
  it("passes a non-MFA user straight through without a freshness read", async () => {
    mockCookieSession(PLAIN_USER);
    const ctx = await requireFreshMfaIfEnrolled(MFA_STEP_UP_MAX_AGE_SECONDS);
    expect(ctx.user.id).toBe("user-1");
    expect(prisma.session.findUnique).not.toHaveBeenCalled();
  });

  it("gates a security-key-only user (no TOTP) on step-up too", async () => {
    mockCookieSession(PLAIN_USER);
    vi.mocked(prisma.webauthnMfaCredential.count).mockResolvedValue(1 as never);
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      mfaVerifiedAt: null,
    } as never);
    await expect(
      requireFreshMfaIfEnrolled(MFA_STEP_UP_MAX_AGE_SECONDS),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it("passes an MFA user with a fresh verification", async () => {
    mockCookieSession(MFA_USER);
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      mfaVerifiedAt: new Date(Date.now() - 60_000),
    } as never);
    const ctx = await requireFreshMfaIfEnrolled(MFA_STEP_UP_MAX_AGE_SECONDS);
    expect(ctx.user.id).toBe("user-1");
  });

  it("blocks an MFA user without a fresh verification", async () => {
    mockCookieSession(MFA_USER);
    vi.mocked(prisma.session.findUnique).mockResolvedValue({
      mfaVerifiedAt: null,
    } as never);
    await expect(
      requireFreshMfaIfEnrolled(MFA_STEP_UP_MAX_AGE_SECONDS),
    ).rejects.toBeInstanceOf(StepUpRequiredError);
  });

  it("a Bearer token can never satisfy step-up for an MFA-enrolled account", async () => {
    // requireAuth resolves the Bearer caller (no cookie), but the step-up read
    // is cookie-only — getSession returns null inside requireFreshMfa.
    vi.mocked(getSession).mockResolvedValue(null as never);
    headersGet.mockImplementation((n) =>
      n.toLowerCase() === "authorization" ? "Bearer hlk_xyz" : null,
    );
    vi.mocked(prisma.apiToken.findUnique).mockResolvedValue({
      id: "tok-1",
      userId: "user-1",
      permissions: ["*"],
      revoked: false,
      expiresAt: null,
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(MFA_USER as never);
    vi.mocked(prisma.apiToken.update).mockResolvedValue({} as never);

    await expect(
      requireFreshMfaIfEnrolled(MFA_STEP_UP_MAX_AGE_SECONDS),
    ).rejects.toBeInstanceOf(HttpError);
  });
});
