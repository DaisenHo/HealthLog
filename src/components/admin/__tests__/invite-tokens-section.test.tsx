/**
 * v1.16.5 — admin invite section: multi-use surface contracts.
 *
 * SSR smoke tests per project convention (`renderToStaticMarkup` +
 * seeded QueryClient; no `@testing-library/react`). Pinned:
 *
 *   1. The table renders `uses / maxUses` for a multi-use invite.
 *   2. uses == maxUses surfaces the "Aufgebraucht" (exhausted) chip.
 *   3. Multiple redemptions render the "+N weitere" popover trigger;
 *      a single redemption renders inline without one.
 *   4. `clampMaxUses` pins the create-dialog field to the 1–50 range
 *      (the same clamp the submit path sends).
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { I18nProvider } from "@/lib/i18n/context";
import {
  InviteTokensSection,
  clampMaxUses,
} from "@/components/admin/invite-tokens-section";
import { queryKeys } from "@/lib/query-keys";
import { primeLocales } from "@/__tests__/helpers/prime-locales";

primeLocales("de");

const FUTURE = new Date(Date.now() + 7 * 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

interface SeedInvite {
  id: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  uses: number;
  maxUses: number;
  creator: { id: string; username: string } | null;
  consumer: { id: string; username: string } | null;
  redemptions: Array<{
    id: string;
    redeemedAt: string;
    user: { id: string; username: string; email: string | null } | null;
  }>;
}

function makeInvite(overrides: Partial<SeedInvite>): SeedInvite {
  return {
    id: "inv-1",
    createdAt: PAST,
    expiresAt: FUTURE,
    usedAt: null,
    revokedAt: null,
    uses: 0,
    maxUses: 1,
    creator: { id: "admin-1", username: "operator" },
    consumer: null,
    redemptions: [],
    ...overrides,
  };
}

function render(invites: SeedInvite[]): string {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: false,
      },
    },
  });
  client.setQueryData(queryKeys.adminInvites(), invites);
  return renderToStaticMarkup(
    <I18nProvider initialLocale="de">
      <QueryClientProvider client={client}>
        <InviteTokensSection />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

describe("InviteTokensSection (multi-use)", () => {
  it("renders uses / maxUses for a partially used multi-use invite", () => {
    const html = render([
      makeInvite({
        uses: 2,
        maxUses: 5,
        redemptions: [
          {
            id: "r1",
            redeemedAt: PAST,
            user: { id: "u1", username: "alpha", email: null },
          },
          {
            id: "r2",
            redeemedAt: PAST,
            user: { id: "u2", username: "beta", email: null },
          },
        ],
      }),
    ]);
    expect(html).toContain("/ 5");
    expect(html).toContain("invite-status-active");
  });

  it("surfaces the exhausted chip when uses reaches maxUses", () => {
    const html = render([
      makeInvite({
        uses: 3,
        maxUses: 3,
        redemptions: [
          {
            id: "r1",
            redeemedAt: PAST,
            user: { id: "u1", username: "alpha", email: null },
          },
          {
            id: "r2",
            redeemedAt: PAST,
            user: { id: "u2", username: "beta", email: null },
          },
          {
            id: "r3",
            redeemedAt: PAST,
            user: { id: "u3", username: "gamma", email: null },
          },
        ],
      }),
    ]);
    expect(html).toContain("invite-status-exhausted");
    expect(html).toContain("Aufgebraucht");
  });

  it("multiple redemptions render the popover trigger with the +N summary", () => {
    const html = render([
      makeInvite({
        uses: 3,
        maxUses: 5,
        redemptions: [
          {
            id: "r1",
            redeemedAt: PAST,
            user: { id: "u1", username: "alpha", email: null },
          },
          {
            id: "r2",
            redeemedAt: PAST,
            user: { id: "u2", username: "beta", email: null },
          },
          {
            id: "r3",
            redeemedAt: PAST,
            user: { id: "u3", username: "gamma", email: null },
          },
        ],
      }),
    ]);
    expect(html).toContain("admin-invite-redemptions-trigger");
    // de: "{username} + {count} weitere" — newest redemption leads.
    expect(html).toContain("alpha + 2 weitere");
  });

  it("a single redemption renders inline without a popover trigger", () => {
    const html = render([
      makeInvite({
        uses: 1,
        maxUses: 5,
        redemptions: [
          {
            id: "r1",
            redeemedAt: PAST,
            user: { id: "u1", username: "alpha", email: null },
          },
        ],
      }),
    ]);
    expect(html).toContain("alpha");
    expect(html).not.toContain("admin-invite-redemptions-trigger");
  });
});

describe("clampMaxUses", () => {
  it("passes the 1–50 range through", () => {
    expect(clampMaxUses("1")).toBe(1);
    expect(clampMaxUses("25")).toBe(25);
    expect(clampMaxUses("50")).toBe(50);
  });

  it("clamps above the cap to 50", () => {
    expect(clampMaxUses("51")).toBe(50);
    expect(clampMaxUses("9999")).toBe(50);
  });

  it("falls back to 1 for zero, negatives, and garbage", () => {
    expect(clampMaxUses("0")).toBe(1);
    expect(clampMaxUses("-3")).toBe(1);
    expect(clampMaxUses("")).toBe(1);
    expect(clampMaxUses("abc")).toBe(1);
  });

  it("truncates decimals to the integer part", () => {
    expect(clampMaxUses("2.9")).toBe(2);
  });
});
