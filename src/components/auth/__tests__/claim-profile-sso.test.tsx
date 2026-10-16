import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import type { ProfileClaimPreview } from "@/lib/queries/use-profile-claim";

/**
 * v1.43 (#959) — the claim page offers the ways in the server names: the
 * password form, the identity provider, or both. A refused single-sign-on
 * claim comes back with `?error=` and no link, and says what happened.
 */

let previewData: ProfileClaimPreview | undefined;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => {}, refresh: () => {}, push: () => {} }),
}));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: null }),
  clearCachesForSessionEnd: () => {},
}));
vi.mock("@/lib/queries/use-profile-claim", () => ({
  useProfileClaimPreview: () => ({ data: previewData, error: null }),
  useClaimProfile: () => ({ mutate: () => {}, isPending: false }),
  useClaimProfileSso: () => ({ mutate: () => {}, isPending: false }),
}));

import { ClaimProfile, claimSsoErrorKey } from "../claim-profile";

const BASE: ProfileClaimPreview = {
  displayName: "Robin",
  expiresAt: "2030-01-01T00:00:00.000Z",
  guardians: [],
};

function render(props: { token: string | null; error?: string | null }) {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider initialLocale="en">
        <ClaimProfile {...props} />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("ClaimProfile — ways in", () => {
  it("offers only the provider on a single-sign-on-only server", () => {
    previewData = { ...BASE, methods: ["sso"], ssoProviderName: "Example ID" };
    const html = render({ token: "hlp_x" });
    expect(html).toContain('data-slot="claim-sso-continue"');
    expect(html).toContain("Continue with Example ID");
    expect(html).not.toContain('id="claim-password"');
    expect(html).not.toContain('id="claim-email"');
    expect(html).not.toContain('data-slot="claim-submit"');
    expect(html).toContain('id="claim-username"');
  });

  it("offers both when both are allowed", () => {
    previewData = {
      ...BASE,
      methods: ["password", "sso"],
      ssoProviderName: "Example ID",
    };
    const html = render({ token: "hlp_x" });
    expect(html).toContain('data-slot="claim-sso-continue"');
    expect(html).toContain('id="claim-password"');
    expect(html).toContain('data-slot="claim-submit"');
  });

  it("offers only the password when an older server names no methods", () => {
    previewData = { ...BASE };
    const html = render({ token: "hlp_x" });
    expect(html).not.toContain('data-slot="claim-sso-continue"');
    expect(html).toContain('id="claim-password"');
  });
});

describe("ClaimProfile — a refused single-sign-on claim", () => {
  it("says what happened and offers a way on", () => {
    previewData = undefined;
    const html = render({ token: null, error: "claim_sso_subject_bound" });
    expect(html).toContain('data-testid="claim-sso-error"');
    expect(html).toContain("already belongs to another account");
    expect(html).toContain('href="/auth/login"');
  });

  it("maps every reason the callback sends, and reads an unknown one as a failure", () => {
    expect(claimSsoErrorKey("claim_expired")).toBe("auth.claim.invalidHint");
    expect(claimSsoErrorKey("claim_sso_subject_bound")).toBe(
      "auth.claim.errorSubjectBound",
    );
    expect(claimSsoErrorKey("claim_email_taken")).toBe(
      "auth.claim.errorEmailTaken",
    );
    expect(claimSsoErrorKey("claim_username_taken")).toBe(
      "auth.claim.errorUsernameTaken",
    );
    expect(claimSsoErrorKey("claim_signed_in")).toBe(
      "auth.claim.errorSignedIn",
    );
    expect(claimSsoErrorKey("oidc_failed")).toBe("auth.claim.errorSso");
    expect(claimSsoErrorKey("<script>")).toBe("auth.claim.errorSso");
  });
});
