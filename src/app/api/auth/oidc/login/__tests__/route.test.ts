import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/api-handler", () => ({
  apiHandler: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock("@/lib/logging/context", () => ({
  annotate: vi.fn(),
  getEvent: () => null,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkAuthSurfaceRateLimit: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  encrypt: vi.fn((s: string) => `enc(${s})`),
}));

vi.mock("@/lib/auth/secure-cookie", () => ({
  shouldEmitSecureCookie: () => true,
}));

vi.mock("@/lib/auth/oidc", async () => {
  // Keep the real `sanitizeOidcNextPath` — it's the security-relevant part
  // of this route, and the tests below assert its output round-trips into
  // the state cookie rather than re-deriving the same logic here.
  const actual =
    await vi.importActual<typeof import("@/lib/auth/oidc")>("@/lib/auth/oidc");
  return {
    getOidcConfig: vi.fn(),
    discoverOidcMetadata: vi.fn(),
    buildAuthorizationUrl: vi.fn(() => "https://idp.example.com/authorize?x=1"),
    getOidcRedirectUri: () =>
      "https://healthlog.example.com/api/auth/oidc/callback",
    oidcAppUrl: (path: string) =>
      new URL(path, "https://healthlog.example.com"),
    sanitizeOidcNextPath: actual.sanitizeOidcNextPath,
  };
});

import { GET } from "../route";
import { checkAuthSurfaceRateLimit } from "@/lib/rate-limit";
import { getOidcConfig, discoverOidcMetadata } from "@/lib/auth/oidc";

function makeRequest(path = "/api/auth/oidc/login"): NextRequest {
  return new NextRequest(`http://localhost${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(checkAuthSurfaceRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 10,
    reset: 0,
    ip: "1.2.3.4",
  } as never);
});

describe("GET /api/auth/oidc/login", () => {
  it("redirects to /auth/login?error=oidc_disabled when unconfigured", async () => {
    vi.mocked(getOidcConfig).mockReturnValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain(
      "/auth/login?error=oidc_disabled",
    );
  });

  it("redirects to the rate-limit error page when throttled", async () => {
    vi.mocked(getOidcConfig).mockReturnValue({
      issuerUrl: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "secret-1",
      scopes: "openid email profile",
      buttonLabel: "SSO",
    });
    vi.mocked(checkAuthSurfaceRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      reset: 0,
      ip: "1.2.3.4",
    } as never);
    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("error=oidc_rate_limited");
  });

  it("redirects to the IdP and sets the encrypted state cookie on success", async () => {
    vi.mocked(getOidcConfig).mockReturnValue({
      issuerUrl: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "secret-1",
      scopes: "openid email profile",
      buttonLabel: "SSO",
    });
    vi.mocked(discoverOidcMetadata).mockResolvedValue({
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/authorize",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
    });

    const res = await GET(makeRequest("/api/auth/oidc/login?next=/dashboard"));
    expect(res.headers.get("location")).toBe(
      "https://idp.example.com/authorize?x=1",
    );
    const cookie = res.cookies.get("oidc_auth_state");
    expect(cookie?.value).toMatch(/^enc\(/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
  });

  it("neutralizes a backslash-normalization open-redirect payload in next", async () => {
    vi.mocked(getOidcConfig).mockReturnValue({
      issuerUrl: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "secret-1",
      scopes: "openid email profile",
      buttonLabel: "SSO",
    });
    vi.mocked(discoverOidcMetadata).mockResolvedValue({
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/authorize",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
    });

    const res = await GET(
      makeRequest(
        `/api/auth/oidc/login?next=${encodeURIComponent("/\\evil.com")}`,
      ),
    );
    const cookie = res.cookies.get("oidc_auth_state");
    const stored = JSON.parse(
      cookie!.value.replace(/^enc\(/, "").replace(/\)$/, ""),
    );
    expect(stored.next).toBe("/");
  });

  it("falls back to the login error page on discovery failure", async () => {
    vi.mocked(getOidcConfig).mockReturnValue({
      issuerUrl: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "secret-1",
      scopes: "openid email profile",
      buttonLabel: "SSO",
    });
    vi.mocked(discoverOidcMetadata).mockRejectedValue(new Error("boom"));
    const res = await GET(makeRequest());
    expect(res.headers.get("location")).toContain("error=oidc_failed");
  });

  describe("native SSO start", () => {
    const CONFIG = {
      issuerUrl: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "secret-1",
      scopes: "openid email profile",
      buttonLabel: "SSO",
    };
    const CHALLENGE = "a".repeat(43); // valid S256 length

    function storedFromCookie(res: Awaited<ReturnType<typeof GET>>) {
      const cookie = res.cookies.get("oidc_auth_state");
      return JSON.parse(cookie!.value.replace(/^enc\(/, "").replace(/\)$/, ""));
    }

    it("rejects a native start with a missing challenge to the custom scheme", async () => {
      vi.mocked(getOidcConfig).mockReturnValue(CONFIG);
      const res = await GET(makeRequest("/api/auth/oidc/login?client=native"));
      expect(res.headers.get("location")).toBe(
        "healthlog://oidc-callback?error=oidc_invalid_request",
      );
    });

    it("routes native login errors (disabled) to the custom scheme", async () => {
      vi.mocked(getOidcConfig).mockReturnValue(null);
      const res = await GET(
        makeRequest(
          `/api/auth/oidc/login?client=native&code_challenge=${CHALLENGE}`,
        ),
      );
      expect(res.headers.get("location")).toBe(
        "healthlog://oidc-callback?error=oidc_disabled",
      );
    });

    it("folds native:true + appCodeChallenge into the state blob and pins next to /", async () => {
      vi.mocked(getOidcConfig).mockReturnValue(CONFIG);
      vi.mocked(discoverOidcMetadata).mockResolvedValue({
        issuer: "https://idp.example.com",
        authorization_endpoint: "https://idp.example.com/authorize",
        token_endpoint: "https://idp.example.com/token",
        jwks_uri: "https://idp.example.com/jwks",
      });

      const res = await GET(
        makeRequest(
          `/api/auth/oidc/login?client=native&code_challenge=${CHALLENGE}&next=/dashboard`,
        ),
      );
      // Still a normal redirect to the IdP — the native fact rides the blob.
      expect(res.headers.get("location")).toBe(
        "https://idp.example.com/authorize?x=1",
      );
      const stored = storedFromCookie(res);
      expect(stored.native).toBe(true);
      expect(stored.appCodeChallenge).toBe(CHALLENGE);
      // `next` is meaningless to the app — pinned to "/".
      expect(stored.next).toBe("/");
      // The server↔IdP verifier stays independent and present.
      expect(typeof stored.codeVerifier).toBe("string");
    });
  });
});

describe("GET /api/auth/oidc/login?intent=claim (v1.43, #959)", () => {
  beforeEach(() => {
    vi.mocked(getOidcConfig).mockReturnValue({
      issuerUrl: "https://idp.example.com",
      clientId: "client-1",
      clientSecret: "secret-1",
      scopes: "openid email profile",
      buttonLabel: "SSO",
    });
  });

  it("refuses a claim on the native leg with oidc_invalid_request", async () => {
    const res = await GET(
      makeRequest(
        `/api/auth/oidc/login?intent=claim&client=native&code_challenge=${"a".repeat(43)}`,
      ),
    );
    expect(res.headers.get("location")).toMatch(
      /^healthlog:\/\/oidc-callback\?error=oidc_invalid_request$/,
    );
    expect(discoverOidcMetadata).not.toHaveBeenCalled();
    expect(res.cookies.get("oidc_auth_state")).toBeUndefined();
  });

  it("sends a claim without its cookie back to the claim page, before the provider", async () => {
    const res = await GET(makeRequest("/api/auth/oidc/login?intent=claim"));
    expect(res.headers.get("location")).toBe(
      "https://healthlog.example.com/auth/claim?error=claim_expired",
    );
    expect(discoverOidcMetadata).not.toHaveBeenCalled();
    expect(res.cookies.get("oidc_auth_state")).toBeUndefined();
  });

  it("routes the claim's other failures to the claim page too", async () => {
    vi.mocked(checkAuthSurfaceRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      reset: 0,
      ip: "1.2.3.4",
    } as never);
    const res = await GET(makeRequest("/api/auth/oidc/login?intent=claim"));
    expect(res.headers.get("location")).toBe(
      "https://healthlog.example.com/auth/claim?error=oidc_rate_limited",
    );
  });
});
